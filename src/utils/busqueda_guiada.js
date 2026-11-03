// daiko/src/utils/busqueda_guiada.js
// Cuando una búsqueda devuelve varios productos, en vez de listarlos pregunta por
// sus características (marca → presentación → tipo) hasta acotar el resultado.
//
// Motivo de hacerlo en código y no con instrucciones al prompt: con varias rondas
// de preguntas GPT pierde el hilo e inventa IDs y precios. Aquí el estado vive en
// Redis y las respuestas las arma este módulo con los productos reales del CRM.
//
// gpt-4o-mini se usa en dos puntos muy acotados y nunca recibe IDs ni precios:
//  - detectarAtributos: qué palabras de los nombres son marca o tipo. Lo que
//    devuelva se descarta si no aparece literal en un nombre real.
//  - interpretarConLLM: a qué opción corresponde una respuesta no literal ("la de
//    un litro"). Sólo puede devolver opciones que ya existen.
//
// Modo de falla intencional: si el LLM falla, se pregunta sólo lo que se puede
// sacar con regex (presentación) o se muestra la lista; si no se entiende la
// respuesta del cliente, se cancela la guía y sigue el flujo normal. Nunca se elige
// un producto por suposición.

const { terminosDeFiltros, calcularRelevancia } = require('./relevancia');
const {
  normalizarBasico,
  extraerMedidas,
  quitarMedidas,
  etiquetaUnidad,
  nombreConUnidad
} = require('./unidad_medida');

const MAX_PRODUCTOS_GUIADOS = 5;    // Más que esto ya no cabe en un mensaje: va directo a lista
const LISTA_SIN_GUIA = 3;           // Resultados por producto cuando no se guía
const MAX_LISTA_POR_PRODUCTO = 6;
const MAX_OPCIONES_VISIBLES = 8;
const COBERTURA_MINIMA = 0.5;       // Si la mayoría no tiene el atributo, la pregunta no sirve
const MAX_ACLARACIONES = 2;         // Después de esto se muestra la lista, para no ciclarse
const TIMEOUT_LLM_MS = 5000;

const ORDEN_ATRIBUTOS = ['marca', 'medida', 'tipo'];
const NOMBRE_PREGUNTA = { marca: 'marca', medida: 'presentación', tipo: 'tipo' };

const REGEX_CUALQUIERA = /\b(CUALQUIERA|LA QUE SEA|EL QUE SEA|LO QUE SEA|ME DA IGUAL|DA IGUAL|NO IMPORTA|LO QUE TENGAS|MUESTRAME TODOS|MUESTRAME TODAS|MUESTRAME TODO|VER TODOS|VER TODAS|VER TODO|VER MAS|HAY MAS|TODOS|TODAS|TODO|LISTA)\b/g;
const REGEX_AMBOS = /\b(AMBOS|AMBAS|LOS DOS|LAS DOS|LOS TRES|LAS TRES|TODOS|TODAS)\b/;
const REGEX_ORDINAL = /\b(PRIMER|PRIMERA|PRIMERO|SEGUNDA|SEGUNDO|TERCER|TERCERA|TERCERO|ULTIMA|ULTIMO)\b/;

// El cliente señala un renglón de la lista en vez de nombrar el producto
const REGEX_POSICION = /\b(EL|LA|LOS|LAS|DEL|AL)\s+(\d+|UNO|DOS|TRES|CUATRO|CINCO|SEIS)\b/;
const REGEX_DEMOSTRATIVO = /\b(ESE|ESA|ESOS|ESAS|ESTE|ESTA|ESTOS|ESTAS|LO)\b/;
const REGEX_COTIZACION = /COTIZ|PRESUPUEST/;

const ACCIONES_CARRITO = ['CARRITO_CREAR', 'CARRITO_MODIFICAR'];
const SUB_ACCIONES_AGREGAR = ['agregar', 'nuevo_carrito_con_productos'];
const TOOLS_AGREGAR = ['agregar_al_carrito', 'crear_nuevo_carrito', 'agregar_varios_articulos_al_carrito', 'crear_nuevo_carrito_con_varios_articulos'];

// Palabras frecuentes que no identifican un producto aunque aparezcan en su nombre
const PALABRAS_SIN_PESO = new Set(['CON', 'DEL', 'LAS', 'LOS', 'MAS', 'PARA', 'POR', 'QUE', 'SIN', 'UNA', 'UNO']);

// Confirmaciones y verbos: "sí", "dale" o "claro que sí" también llegan clasificados como
// carrito y no nombran ningún producto. Van ya en singular, como los deja palabrasDelMensaje.
const PALABRAS_SIN_PRODUCTO = new Set([
  'ACUERDO', 'ADELANTE', 'AJA', 'AMBO', 'ANDALE', 'ARTICULO', 'BIEN', 'BUSCO', 'CAJA', 'CLARO', 'CONFIRMA', 'CONFIRMO',
  'CORRECTO', 'DALE', 'DAME', 'EXACTO', 'FAVOR', 'GRACIA', 'HAZLO', 'MANDA', 'MISMO', 'NECESITO', 'OCUPO', 'OTRA', 'OTRO',
  'PAQUETE', 'PERFECTO', 'PIEZA', 'PORFA', 'PORFAVOR', 'PRODUCTO', 'PUEDE', 'QUIERO', 'QUISIERA', 'REQUIERO', 'SALE',
  'SERIA', 'SIMON', 'SIP', 'TAMBIEN', 'TODO', 'UNIDAD', 'VALE'
]);

const NUMEROS_EN_LETRA = { DOS: 2, TRES: 3, CUATRO: 4, CINCO: 5, SEIS: 6, SIETE: 7, OCHO: 8, NUEVE: 9, DIEZ: 10, DOCE: 12 };

// Palabras que pueden acompañar a una opción sin cambiar su significado. Si queda
// algo fuera de esta lista ("no quiero ciel, mejor arroz") la respuesta no se toma
// como literal.
const PALABRAS_RELLENO = new Set([
  'A', 'AL', 'DE', 'DEL', 'E', 'EL', 'EN', 'ESA', 'ESE', 'GRACIAS', 'LA', 'LAS', 'LOS', 'ME', 'MARCA', 'O', 'OK',
  'OPCION', 'PARA', 'PORFA', 'PORFAVOR', 'POR', 'FAVOR', 'PREFIERO', 'PRESENTACION', 'QUIERO', 'QUISIERA', 'SI',
  'TIPO', 'U', 'UN', 'UNA', 'UNO', 'Y', 'DAME', 'GUSTARIA'
]);

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Palabra o frase completa: "CIEL" no engancha "CIELO"
function contieneFrase(textoNormalizado, frase) {
  if (!frase) return false;
  return new RegExp('(?<![A-Z0-9])' + escaparRegex(frase) + '(?![A-Z0-9])').test(textoNormalizado);
}

// Como contieneFrase, pero acepta el plural: "AGUA" engancha "AGUAS", no "AGUACATE"
function contieneSustantivo(nombreNormalizado, sustantivo) {
  const tokens = normalizarBasico(sustantivo).split(' ').filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every(function (t) {
    return new RegExp('(?<![A-Z0-9])' + escaparRegex(t) + '(?:S|ES)?(?![A-Z0-9])').test(nombreNormalizado);
  });
}

function capitalizar(texto) {
  return String(texto).toLowerCase().replace(/(^|\s)(\S)/g, function (m, esp, letra) {
    return esp + letra.toUpperCase();
  });
}

function unirConO(lista) {
  if (lista.length <= 1) return lista.join('');
  return lista.slice(0, -1).join(', ') + ' o ' + lista[lista.length - 1];
}

function conTimeout(promesa) {
  let timer;
  const limite = new Promise(function (_, reject) {
    timer = setTimeout(function () { reject(new Error('Timeout LLM')); }, TIMEOUT_LLM_MS);
  });
  return Promise.race([promesa, limite]).finally(function () { clearTimeout(timer); });
}

// ============================================================
// CANDIDATOS
// ============================================================

/**
 * El CRM trae también coincidencias por etiqueta y descarta filtros cuando no hay
 * resultados. Para preguntar sólo se usan los productos que de verdad cumplen lo
 * que pidió el cliente; si ninguno cumple, se conservan todos para no perder recall.
 */
function filtrarCandidatos(productos, sustantivo, filtros) {
  const terminos = terminosDeFiltros(filtros);
  const cumplenFiltros = productos.filter(function (p) {
    return terminos.every(function (t) { return calcularRelevancia(p.NOMBRE, '', [t]) > 0; });
  });
  const hayFiltrosAplicados = terminos.length > 0 && cumplenFiltros.length > 0;
  const base = cumplenFiltros.length > 0 ? cumplenFiltros : productos;

  // Sólo la primera palabra: "AIRE ACONDICIONA SUPER..." está mal escrito en el catálogo
  // y exigir "ACONDICIONADO" lo dejaría fuera. Las siguientes preguntas ya separan el resto.
  const primeraPalabra = normalizarBasico(sustantivo).split(' ')[0];
  const conSustantivo = base.filter(function (p) {
    return contieneSustantivo(normalizarBasico(p.NOMBRE), primeraPalabra);
  });

  return {
    candidatos: conSustantivo.length > 0 ? conSustantivo : base,
    // Lo que el cliente ya especificó no se le vuelve a preguntar
    atributosResueltos: hayFiltrosAplicados
      ? ORDEN_ATRIBUTOS.filter(function (a) {
          return filtros && Array.isArray(filtros[a]) && filtros[a].length > 0;
        })
      : []
  };
}

/**
 * Acumula las búsquedas de un turno. El mismo sustantivo se junta en un solo
 * producto: cubre el reintento sin filtros y "agua ciel y agua epura".
 *
 * @param {Array}  busquedas - Acumulado del turno (se modifica)
 * @param {object} busqueda  - {etiqueta, sustantivo, filtros, productos, total}
 */
function registrarBusqueda(busquedas, busqueda) {
  const productos = Array.isArray(busqueda.productos) ? busqueda.productos : [];
  const sustantivo = busqueda.sustantivo || busqueda.etiqueta;
  const clave = normalizarBasico(sustantivo);
  const { candidatos, atributosResueltos } = filtrarCandidatos(productos, sustantivo, busqueda.filtros);

  let item = busquedas.find(function (b) { return b.clave === clave; });
  if (!item) {
    item = {
      clave,
      etiqueta: String(busqueda.etiqueta || sustantivo).trim().toLowerCase(),
      candidatos: [],
      resueltos: atributosResueltos,
      filtros: busqueda.filtros || null,
      truncado: false,
      cantidad: busqueda.cantidad || null
    };
    busquedas.push(item);
  } else if (candidatos.length > 0) {
    // Sólo cuenta lo resuelto en AMBAS búsquedas si las dos encontraron algo
    item.resueltos = item.candidatos.length > 0
      ? item.resueltos.filter(function (a) { return atributosResueltos.includes(a); })
      : atributosResueltos;
    item.filtros = busqueda.filtros || item.filtros;
  }

  const ids = new Set(item.candidatos.map(function (p) { return String(p.ARTICULO_ID); }));
  candidatos.forEach(function (p) {
    if (!ids.has(String(p.ARTICULO_ID))) {
      ids.add(String(p.ARTICULO_ID));
      item.candidatos.push(p);
    }
  });

  if (Number(busqueda.total) > productos.length) item.truncado = true;
  return busquedas;
}

// ============================================================
// OPCIONES DE CADA PREGUNTA
// ============================================================

/**
 * Sólo vale la pena preguntar si hay al menos 2 opciones reales que separen los
 * candidatos y cubran a la mayoría. Lo que no tenga el atributo va en "otra opción"
 * para que ningún producto desaparezca.
 */
function armarOpciones(grupos, candidatos) {
  const reales = grupos
    .filter(function (g) { return g.ids.length > 0 && g.ids.length < candidatos.length; })
    .sort(function (a, b) { return b.ids.length - a.ids.length; });
  if (reales.length < 2) return null;

  const cubiertos = new Set();
  reales.forEach(function (g) { g.ids.forEach(function (id) { cubiertos.add(id); }); });
  if (cubiertos.size / candidatos.length < COBERTURA_MINIMA) return null;

  const sinAtributo = candidatos
    .map(function (p) { return String(p.ARTICULO_ID); })
    .filter(function (id) { return !cubiertos.has(id); });
  if (sinAtributo.length > 0) {
    reales.push({ etiqueta: 'otra opción', termino: 'OTRA', alias: ['OTRO'], ids: sinAtributo, esOtra: true });
  }
  return reales;
}

function opcionesPorTerminos(terminos, candidatos) {
  const grupos = (terminos || []).map(function (termino) {
    return {
      etiqueta: capitalizar(termino),
      termino,
      ids: candidatos
        .filter(function (p) { return contieneFrase(normalizarBasico(p.NOMBRE), termino); })
        .map(function (p) { return String(p.ARTICULO_ID); })
    };
  });
  return armarOpciones(grupos, candidatos);
}

// Presentación: la medida del nombre o, si no trae, la unidad de venta del CRM
function opcionesPorPresentacion(candidatos) {
  const grupos = new Map();
  candidatos.forEach(function (p) {
    const medidas = extraerMedidas(p.NOMBRE);
    const clave = medidas.length > 0 ? medidas.join(' ') : etiquetaUnidad(p.UNIDAD_VENTA);
    if (!clave) return;
    if (!grupos.has(clave)) {
      grupos.set(clave, { etiqueta: clave, termino: clave, medidas, ids: [] });
    }
    grupos.get(clave).ids.push(String(p.ARTICULO_ID));
  });
  return armarOpciones([...grupos.values()], candidatos);
}

function opcionesDeAtributo(item, atributo) {
  if (atributo === 'medida') return opcionesPorPresentacion(item.candidatos);
  const terminos = atributo === 'marca' ? item.atributos.marcas : item.atributos.tipos;
  return opcionesPorTerminos(terminos, item.candidatos);
}

function avanzarPregunta(item) {
  item.pregunta = null;
  if (item.lista || item.candidatos.length <= 1) return;

  for (const atributo of ORDEN_ATRIBUTOS) {
    if (item.resueltos.includes(atributo)) continue;
    const opciones = opcionesDeAtributo(item, atributo);
    if (opciones) {
      item.pregunta = { atributo, opciones };
      return;
    }
    item.resueltos.push(atributo);
  }
}

// ============================================================
// LLM ACOTADO
// ============================================================

/**
 * Identifica qué palabras de los nombres son marca o tipo. Valida contra los nombres
 * reales: lo que no aparezca literal se descarta.
 */
async function detectarAtributos(openai, item) {
  const vacio = { marcas: [], tipos: [] };
  const nombres = item.candidatos.map(function (p) { return normalizarBasico(p.NOMBRE); });

  try {
    const respuesta = await conTimeout(openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Analizas nombres de productos de un catálogo de "${item.etiqueta}". Responde SOLO un JSON: {"marcas":[...],"tipos":[...]}.

- marcas: marcas comerciales, copiadas EXACTAMENTE como aparecen en los nombres.
- tipos: variantes del producto (sabor, color, material, uso), copiadas EXACTAMENTE como aparecen en los nombres.

No incluyas el nombre genérico del producto, medidas, cantidades, ni códigos. Si no estás seguro de que una palabra sea marca, no la incluyas. No agregues nada que no esté escrito en los nombres.`
        },
        { role: 'user', content: nombres.join('\n') }
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 500
    }));

    const parsed = JSON.parse(respuesta.choices[0].message.content);
    const validar = function (lista) {
      if (!Array.isArray(lista)) return [];
      const terminos = lista
        .filter(function (t) { return typeof t === 'string'; })
        .map(normalizarBasico)
        .filter(function (t) {
          return t && !contieneSustantivo(t, item.clave) && extraerMedidas(t).length === 0 &&
            nombres.some(function (n) { return contieneFrase(n, t); });
        });
      return [...new Set(terminos)];
    };

    const atributos = { marcas: validar(parsed.marcas), tipos: validar(parsed.tipos) };
    console.log(`🧭 Atributos de "${item.etiqueta}":`, atributos);
    return atributos;
  } catch (error) {
    console.warn(`⚠️ No se pudieron detectar atributos de "${item.etiqueta}" (fail-open): ${error.message}`);
    return vacio;
  }
}

/**
 * Para respuestas no literales. Sólo puede devolver opciones existentes: lo demás se
 * ignora al validar. Devuelve null si falla, y entonces se sigue con el flujo normal.
 */
async function interpretarConLLM(openai, pendientes, mensaje) {
  const productos = pendientes.map(function (item, indice) {
    return {
      indice,
      producto: item.etiqueta,
      pregunta: NOMBRE_PREGUNTA[item.pregunta.atributo],
      opciones: item.pregunta.opciones.map(function (o) { return o.termino; })
    };
  });

  try {
    const respuesta = await conTimeout(openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Le preguntaste a un cliente por características de productos y debes clasificar su respuesta. Responde SOLO un JSON:
{"cambio_de_tema":false,"aclarar":false,"productos":[{"indice":0,"opciones":["..."],"cualquiera":false}]}

Reglas:
- "opciones": SOLO valores copiados de la lista de opciones de ese producto, y solo si el cliente claramente eligió ese valor. "medio litro" corresponde a "500 ML" o "1/2 LT"; "un litro" a "1 LT".
- "cualquiera": true si el cliente dice que le da igual o quiere ver todos los de ese producto.
- Omite los productos sobre los que el cliente no dijo nada.
- "cambio_de_tema": true si pide otro producto, cambia de idea, pregunta otra cosa, o pide reiniciar, ver el carrito o hablar con alguien.
- "aclarar": true si responde a la pregunta pero no se puede saber a qué opción o producto se refiere.
- Nunca adivines: ante la duda deja "opciones" vacío y marca "aclarar".`
        },
        { role: 'user', content: `Preguntas: ${JSON.stringify(productos)}\nRespuesta del cliente: "${mensaje}"` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 300
    }));

    const parsed = JSON.parse(respuesta.choices[0].message.content);
    const resultado = { cambioDeTema: parsed.cambio_de_tema === true, aclarar: parsed.aclarar === true, selecciones: [] };

    (Array.isArray(parsed.productos) ? parsed.productos : []).forEach(function (r) {
      const item = pendientes[r && r.indice];
      if (!item) return;
      const elegidas = item.pregunta.opciones.filter(function (o) {
        return Array.isArray(r.opciones) && r.opciones.map(normalizarBasico).includes(normalizarBasico(o.termino));
      });
      if (elegidas.length > 0) resultado.selecciones.push({ item, opciones: elegidas });
      else if (r.cualquiera === true) resultado.selecciones.push({ item, cualquiera: true });
    });

    return resultado;
  } catch (error) {
    console.warn(`⚠️ No se pudo interpretar la respuesta (se sigue con el flujo normal): ${error.message}`);
    return null;
  }
}

// ============================================================
// INTERPRETACIÓN LITERAL
// ============================================================

function opcionCoincide(opcion, texto, medidasMensaje, numerosSueltos) {
  if (opcion.medidas && opcion.medidas.length > 0) {
    return opcion.medidas.some(function (m) {
      return medidasMensaje.includes(m) || numerosSueltos.includes(m.split(' ')[0]);
    });
  }
  return [opcion.termino].concat(opcion.alias || []).some(function (t) { return contieneFrase(texto, t); });
}

/**
 * Interpreta la respuesta sin LLM. Devuelve null si queda cualquier palabra sin
 * explicar, para que "no quiero ciel, mejor arroz" no se tome como elegir Ciel.
 */
function interpretarLiteral(pendientes, mensaje) {
  const normalizado = normalizarBasico(mensaje).replace(/[,;:!?¿¡()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalizado) return null;

  const medidasMensaje = extraerMedidas(normalizado);
  let texto = quitarMedidas(normalizado);
  const numerosSueltos = (texto.match(/(?<![\d./])\d+(?:\.\d+)?(?![\d./])/g) || []);

  const selecciones = [];
  const usadas = new Map();  // opción elegida → productos en los que aparece, para detectar ambigüedad

  pendientes.forEach(function (item) {
    item.pregunta.opciones.forEach(function (opcion) {
      if (!opcionCoincide(opcion, texto, medidasMensaje, numerosSueltos)) return;
      if (!usadas.has(opcion.termino)) usadas.set(opcion.termino, []);
      usadas.get(opcion.termino).push({ item, opcion });
    });
  });

  // ¿Queda algo sin explicar? Medidas pedidas que no son opción también cuentan
  const medidasOfrecidas = [];
  usadas.forEach(function (lista) {
    lista.forEach(function (u) {
      if (u.opcion.medidas) medidasOfrecidas.push(...u.opcion.medidas);
    });
  });
  if (medidasMensaje.some(function (m) { return !medidasOfrecidas.includes(m); })) return null;

  const sustantivos = new Set();
  pendientes.forEach(function (item) {
    normalizarBasico(item.clave).split(' ').forEach(function (t) { sustantivos.add(t); });
  });

  usadas.forEach(function (lista) {
    const o = lista[0].opcion;
    [o.termino].concat(o.alias || []).forEach(function (t) {
      texto = texto.replace(new RegExp('(?<![A-Z0-9])' + escaparRegex(t) + '(?![A-Z0-9])', 'g'), ' ');
    });
    (o.medidas || []).forEach(function (m) {
      texto = texto.replace(new RegExp('(?<![\\d./])' + escaparRegex(m.split(' ')[0]) + '(?![\\d./])', 'g'), ' ');
    });
  });

  const cualquiera = texto.search(REGEX_CUALQUIERA) !== -1;
  texto = texto.replace(REGEX_CUALQUIERA, ' ');

  const sobrantes = texto.split(/\s+/).filter(Boolean).filter(function (p) { return !PALABRAS_RELLENO.has(p); });
  // Con varios productos, nombrar uno ("soriana para el arroz") cambia el sentido: lo resuelve el LLM
  const sobranSoloSustantivos = sobrantes.every(function (p) { return sustantivos.has(p) || sustantivos.has(p.replace(/(ES|S)$/, '')); });
  if (sobrantes.length > 0 && (pendientes.length > 1 || !sobranSoloSustantivos)) return null;

  if (usadas.size === 0 && !cualquiera) return null;

  let ambiguo = null;
  usadas.forEach(function (lista) {
    if (lista.length === 1) {
      const existente = selecciones.find(function (s) { return s.item === lista[0].item; });
      if (existente) existente.opciones.push(lista[0].opcion);
      else selecciones.push({ item: lista[0].item, opciones: [lista[0].opcion] });
    } else if (!ambiguo) {
      ambiguo = { etiqueta: lista[0].opcion.etiqueta, termino: lista[0].opcion.termino, claves: lista.map(function (u) { return u.item.clave; }) };
    }
  });

  if (cualquiera) {
    pendientes.forEach(function (item) {
      const yaElegido = selecciones.some(function (s) { return s.item === item; });
      const enAmbiguo = ambiguo && ambiguo.claves.includes(item.clave);
      if (!yaElegido && !enAmbiguo) selecciones.push({ item, cualquiera: true });
    });
  }

  return { selecciones, ambiguo };
}

/**
 * Respuesta a "¿Soriana para agua, para arroz o para ambos?"
 */
function resolverAclaracion(estado, mensaje) {
  const aclaracion = estado.aclaracion;
  estado.aclaracion = null;
  const texto = normalizarBasico(mensaje);

  const items = estado.items.filter(function (i) { return i.pregunta && aclaracion.claves.includes(i.clave); });
  const elegidos = REGEX_AMBOS.test(texto)
    ? items
    : items.filter(function (i) { return contieneSustantivo(texto, i.clave); });
  if (elegidos.length === 0) return null;

  const selecciones = [];
  elegidos.forEach(function (item) {
    const opcion = item.pregunta.opciones.find(function (o) { return o.termino === aclaracion.termino; });
    if (opcion) selecciones.push({ item, opciones: [opcion] });
  });
  return selecciones.length > 0 ? { selecciones, ambiguo: null } : null;
}

// ============================================================
// TEXTOS
// ============================================================

function textoPregunta(item) {
  const { atributo, opciones } = item.pregunta;
  const reales = opciones.filter(function (o) { return !o.esOtra; });
  const otra = opciones.find(function (o) { return o.esOtra; });
  const visibles = reales.slice(0, MAX_OPCIONES_VISIBLES).map(function (o) { return o.etiqueta; });
  const hayMas = reales.length > MAX_OPCIONES_VISIBLES || item.truncado;

  let lista;
  if (hayMas) {
    lista = visibles.join(', ') + ', entre otras';
  } else {
    lista = unirConO(otra ? visibles.concat(otra.etiqueta) : visibles);
  }
  return `¿Qué ${NOMBRE_PREGUNTA[atributo]} de ${item.etiqueta} prefieres? Tenemos ${lista}.`;
}

function textoProducto(numero, producto) {
  return `${numero}) ID: ${producto.ARTICULO_ID} - ${nombreConUnidad(producto)}\n   Precio: $${producto.PRECIO}`;
}

// La cantidad que el cliente ya dijo no se le vuelve a preguntar
function preguntaDeCierre(items, totalMostrados) {
  const todosConCantidad = items.every(function (i) { return i.cantidad; });
  if (todosConCantidad && totalMostrados === items.length) {
    return totalMostrados === 1 ? '¿Quieres que lo agregue?' : '¿Quieres que los agregue?';
  }
  if (todosConCantidad) return '¿Cuál te agrego?';
  return totalMostrados === 1 ? '¿Cuántos te agrego?' : '¿Cuál te agrego y cuántos?';
}

/**
 * Lista final: formato de siempre, para que "el primero" y agregar al carrito sigan
 * funcionando. Los productos no mostrados quedan después, para que "ver más" continúe.
 */
function armarFinal(estado, maxPorProducto) {
  const lineas = [];
  const mostrados = [];
  const resto = [];
  const conMas = [];

  estado.items.forEach(function (item) {
    const visibles = item.candidatos.slice(0, maxPorProducto);
    visibles.forEach(function (p) {
      mostrados.push(p);
      lineas.push(textoProducto(mostrados.length, p));
    });
    if (item.cantidad && visibles.length === 1) {
      lineas[lineas.length - 1] += `\n   Cantidad: ${item.cantidad}`;
    } else if (item.cantidad) {
      lineas.push(`Cantidad solicitada de ${item.etiqueta}: ${item.cantidad}`);
    }
    const restantes = item.candidatos.slice(maxPorProducto);
    resto.push(...restantes);
    if (restantes.length > 0) conMas.push(item.etiqueta);
  });

  const partes = [];
  const noEncontrados = estado.noEncontrados || [];
  if (noEncontrados.length > 0) partes.push(`No encontré ${unirConO(noEncontrados)}.`);
  partes.push(lineas.join('\n\n'));
  if (conMas.length > 0) partes.push(`Hay más opciones disponibles de ${conMas.join(', ')}.`);
  partes.push(preguntaDeCierre(estado.items, mostrados.length));

  return {
    texto: partes.join('\n\n'),
    estado: null,
    productos: mostrados.concat(resto),
    mostrados: mostrados.length,
    query: estado.items.map(function (i) { return i.clave; }).join(', '),
    filtros: estado.items.length === 1 ? estado.items[0].filtros : null
  };
}

function armarPaso(estado, prefijo) {
  const pendientes = estado.items.filter(function (i) { return i.pregunta; });
  if (pendientes.length === 0) return armarFinal(estado, MAX_LISTA_POR_PRODUCTO);

  const preguntas = pendientes.map(textoPregunta).join('\n');
  const productos = [];
  estado.items.forEach(function (i) { productos.push(...i.candidatos); });

  return {
    texto: prefijo ? prefijo + '\n' + preguntas : preguntas,
    estado,
    productos,
    mostrados: 0,
    query: estado.items.map(function (i) { return i.clave; }).join(', '),
    filtros: estado.items.length === 1 ? estado.items[0].filtros : null
  };
}

function armarAclaracion(estado, ambiguo) {
  const items = estado.items.filter(function (i) { return ambiguo.claves.includes(i.clave); });
  const para = items.map(function (i) { return 'para ' + i.etiqueta; });
  const todos = items.length === 2 ? 'para ambos' : 'para todos';
  estado.aclaracion = ambiguo;
  const paso = armarPaso(estado);
  paso.texto = `¿${ambiguo.etiqueta} ${para.join(', ')} o ${todos}?`;
  return paso;
}

// ============================================================
// API DEL MÓDULO
// ============================================================

function hayProductos(busquedas) {
  return busquedas.some(function (b) { return b.candidatos.length > 0; });
}

/**
 * Arranca la guía con las búsquedas de un turno.
 *
 * @param {Array}  busquedas - Acumuladas con registrarBusqueda
 * @param {object} openai    - Cliente OpenAI
 * @returns {Promise<object>} {texto, estado, productos, mostrados, query, filtros}.
 *          estado === null significa que ya no quedan preguntas.
 */
async function iniciarGuia(busquedas, openai) {
  const items = busquedas.filter(function (b) { return b.candidatos.length > 0; });
  const estado = {
    items,
    noEncontrados: busquedas.filter(function (b) { return b.candidatos.length === 0; }).map(function (b) { return b.etiqueta; }),
    aclaraciones: 0,
    aclaracion: null
  };

  if (items.length > MAX_PRODUCTOS_GUIADOS) {
    console.log(`🧭 ${items.length} productos en un mensaje (máx ${MAX_PRODUCTOS_GUIADOS}): lista directa sin preguntas`);
    return armarFinal(estado, LISTA_SIN_GUIA);
  }

  await Promise.all(items.map(async function (item) {
    item.atributos = item.candidatos.length > 1
      ? await detectarAtributos(openai, item)
      : { marcas: [], tipos: [] };
    avanzarPregunta(item);
  }));

  return armarPaso(estado);
}

function aplicarSelecciones(selecciones) {
  selecciones.forEach(function (s) {
    if (s.cualquiera) {
      s.item.lista = true;
    } else {
      const ids = new Set();
      s.opciones.forEach(function (o) { o.ids.forEach(function (id) { ids.add(id); }); });
      s.item.candidatos = s.item.candidatos.filter(function (p) { return ids.has(String(p.ARTICULO_ID)); });
      s.item.resueltos.push(s.item.pregunta.atributo);
    }
    avanzarPregunta(s.item);
  });
}

// Tope para no repetir la misma pregunta: se muestra lo que haya de los pendientes
function excedeAclaraciones(estado) {
  estado.aclaraciones = (estado.aclaraciones || 0) + 1;
  if (estado.aclaraciones <= MAX_ACLARACIONES) return false;
  estado.aclaracion = null;
  estado.items.forEach(function (i) {
    if (i.pregunta) { i.lista = true; i.pregunta = null; }
  });
  return true;
}

/**
 * Procesa la respuesta del cliente a la pregunta pendiente.
 *
 * @returns {Promise<object|null>} Mismo formato que iniciarGuia. null significa que la
 *          respuesta no era para la guía: se cancela y sigue el flujo normal.
 */
async function procesarRespuesta(estado, mensaje, openai) {
  const pendientes = estado.items.filter(function (i) { return i.pregunta; });
  if (pendientes.length === 0) return null;

  let interpretacion = estado.aclaracion ? resolverAclaracion(estado, mensaje) : null;
  if (!interpretacion) interpretacion = interpretarLiteral(pendientes, mensaje);

  if (!interpretacion) {
    const texto = normalizarBasico(mensaje);
    const nombraProducto = pendientes.some(function (i) { return contieneSustantivo(texto, i.clave); });

    // "la primera" con varios productos no se adivina
    if (pendientes.length > 1 && REGEX_ORDINAL.test(texto) && !nombraProducto) {
      interpretacion = { selecciones: [], aclarar: true };
    } else {
      const llm = await interpretarConLLM(openai, pendientes, mensaje);
      if (!llm || llm.cambioDeTema) return null;
      if (llm.selecciones.length === 0 && !llm.aclarar) return null;
      interpretacion = llm;
    }
  }

  aplicarSelecciones(interpretacion.selecciones);

  if (interpretacion.ambiguo) {
    if (excedeAclaraciones(estado)) return armarPaso(estado);
    return armarAclaracion(estado, interpretacion.ambiguo);
  }

  if (interpretacion.selecciones.length === 0) {
    if (excedeAclaraciones(estado)) return armarPaso(estado);
    return armarPaso(estado, 'No me quedó claro a cuál te refieres.');
  }

  estado.aclaraciones = 0;
  return armarPaso(estado);
}

function mensajeSenalaRenglon(textoNormalizado) {
  return REGEX_ORDINAL.test(textoNormalizado) || REGEX_POSICION.test(textoNormalizado) ||
    REGEX_DEMOSTRATIVO.test(textoNormalizado) || textoNormalizado.includes('=');
}

/**
 * El clasificador toma "quiero un aire y un balón" como carrito cuando esos nombres
 * coinciden con productos ya mostrados, y GPT termina eligiendo cuál agregar. Si el
 * cliente sólo nombra productos, sin pedir agregar ni señalar un renglón, es búsqueda.
 *
 * Con cantidad ("quiero 2 aires") sigue por carrito para no perderla:
 * ahí la protege detectarAgregadoAmbiguo.
 *
 * @param {object}  clasificacion - Resultado del clasificador
 * @param {string}  mensaje       - Mensaje del cliente
 * @param {boolean} pideCarrito   - Resultado de mensajePideCarrito
 * @returns {boolean}
 */
function debeTratarseComoBusqueda(clasificacion, mensaje, pideCarrito) {
  if (!clasificacion || pideCarrito || !ACCIONES_CARRITO.includes(clasificacion.accion)) return false;
  if (clasificacion.sub_accion && !SUB_ACCIONES_AGREGAR.includes(clasificacion.sub_accion)) return false;

  // No se exige parametros.texto_busqueda: el clasificador a veces lo manda vacío
  const parametros = clasificacion.parametros || {};
  if (parametros.referencia || Number.isInteger(parametros.referencia_idx)) return false;
  if (Number(parametros.cantidad) > 1) return false;

  const texto = normalizarBasico(mensaje);
  if (REGEX_COTIZACION.test(texto) || mensajeSenalaRenglon(texto)) return false;
  // Números que no son medida ("quiero 2 aires", "100 hebillas") son una cantidad
  if (/\d/.test(quitarMedidas(texto))) return false;

  return palabrasDelMensaje(texto).some(function (p) { return !PALABRAS_SIN_PRODUCTO.has(p); });
}

/**
 * ¿La respuesta de un turno que sólo buscó se arma con la guía? Es el respaldo de
 * debeTratarseComoBusqueda: no depende de lo que traiga el clasificador en parámetros.
 * Quedan fuera las cotizaciones y listas de varias líneas, que tienen su propio formato.
 *
 * @param {object}  clasificacion - Resultado del clasificador (null = fallback)
 * @param {string}  mensaje       - Mensaje del cliente
 * @param {boolean} pideCarrito   - Resultado de mensajePideCarrito
 * @returns {boolean}
 */
function accionAdmiteGuia(clasificacion, mensaje, pideCarrito) {
  if (pideCarrito) return false;
  if (!clasificacion || clasificacion.accion === 'BUSQUEDA_PRODUCTO' || clasificacion.accion === 'DESCONOCIDO') return true;
  if (!ACCIONES_CARRITO.includes(clasificacion.accion)) return false;

  const texto = String(mensaje || '').trim();
  return !texto.includes('\n') && !REGEX_COTIZACION.test(normalizarBasico(texto));
}

/**
 * Cantidad que el cliente pidió de un producto: "quiero 2 aires y tres balones".
 * Sólo la toma si el número va pegado al producto; si no, se le pregunta al final.
 *
 * @returns {number|null}
 */
function cantidadPedida(mensaje, sustantivo) {
  const palabra = normalizarBasico(sustantivo).split(' ')[0];
  if (!palabra) return null;

  const numeros = '\\d+|' + Object.keys(NUMEROS_EN_LETRA).join('|');
  const regex = new RegExp(
    '(?<![\\d.A-Z])(' + numeros + ')\\s+(?:(?:PIEZAS?|PZAS?|UNIDADES|CAJAS?|DE)\\s+)*' + escaparRegex(palabra)
  );
  const m = normalizarBasico(mensaje).match(regex);
  if (!m) return null;

  const cantidad = NUMEROS_EN_LETRA[m[1]] || Number(m[1]);
  return cantidad > 0 ? cantidad : null;
}

function productosDeTool(nombreTool, args) {
  if (!TOOLS_AGREGAR.includes(nombreTool) || !args) return null;
  if (Array.isArray(args.productos)) {
    return args.productos.map(function (p) { return { id: String(p.articulo_id), cantidad: p.unidades }; });
  }
  return args.producto_id ? [{ id: String(args.producto_id), cantidad: args.cantidad }] : null;
}

function palabrasDelMensaje(textoNormalizado) {
  const palabras = quitarMedidas(textoNormalizado).match(/[A-ZÑ]{3,}/g) || [];
  return [...new Set(palabras
    .filter(function (p) { return !PALABRAS_SIN_PESO.has(p); })
    // AIRES → AIRE, BALONES → BALON. También es el texto que ve el cliente en la pregunta
    .map(function (p) { return p.length > 4 ? p.replace(/([AEIOU])S$/, '$1').replace(/([^AEIOU])ES$/, '$1') : p; }))];
}

// Inicio de palabra: "AIRE" engancha "AIRES", "BALON" engancha "BALONES"
function nombreContiene(nombreNormalizado, palabra) {
  return new RegExp('(?<![A-Z0-9])' + escaparRegex(palabra)).test(nombreNormalizado);
}

/**
 * Última barrera antes de escribir en el carrito: si el cliente nombró un producto
 * ("agrégame un aire") y hay varios que coinciden con lo que dijo, GPT está eligiendo
 * por él. Se compara lo que dijo el cliente contra los productos reales.
 *
 * Si no se puede comprobar (no nombra nada, ID fuera del catálogo) devuelve null y la
 * operación sigue igual que antes: esto sólo bloquea cuando la ambigüedad es segura.
 *
 * @param {string} nombreTool    - Tool que GPT quiere ejecutar
 * @param {object} args          - Argumentos de la tool
 * @param {string} mensaje       - Mensaje del cliente
 * @param {object} clasificacion - Resultado del clasificador (puede ser null)
 * @param {Array}  catalogo      - Productos reales conocidos en esta conversación
 * @returns {Array|null} Búsquedas listas para iniciarGuia, o null si no hay ambigüedad
 */
function detectarAgregadoAmbiguo(nombreTool, args, mensaje, clasificacion, catalogo) {
  const solicitados = productosDeTool(nombreTool, args);
  if (!solicitados || solicitados.length === 0 || !mensaje) return null;

  const parametros = (clasificacion && clasificacion.parametros) || {};
  const texto = normalizarBasico(mensaje);
  if (parametros.referencia || Number.isInteger(parametros.referencia_idx) || mensajeSenalaRenglon(texto)) return null;

  const palabras = palabrasDelMensaje(texto);
  const productos = new Map();
  (catalogo || []).forEach(function (p) { productos.set(String(p.ARTICULO_ID), p); });
  const lista = [...productos.values()];
  // "un" también es una cantidad; lo que GPT rellena por defecto en 1 no lo es
  const dijoUno = /\b(UN|UNA|UNO|1)\b/.test(texto);

  const busquedas = [];
  let hayAmbiguo = false;

  for (const solicitado of solicitados) {
    const producto = productos.get(solicitado.id);
    if (!producto) return null;

    const nombre = normalizarBasico(producto.NOMBRE);
    const usadas = palabras.filter(function (p) { return nombreContiene(nombre, p); });
    if (usadas.length === 0) return null;

    const coincidencias = lista.filter(function (p) {
      const n = normalizarBasico(p.NOMBRE);
      return usadas.every(function (u) { return nombreContiene(n, u); });
    });
    if (coincidencias.length > 1) hayAmbiguo = true;

    const cantidad = Number(solicitado.cantidad);
    registrarBusqueda(busquedas, {
      etiqueta: usadas.join(' '),
      sustantivo: usadas.join(' '),
      productos: coincidencias,
      total: coincidencias.length,
      cantidad: cantidad > 1 ? cantidad : (dijoUno ? 1 : null)
    });
  }

  return hayAmbiguo ? busquedas : null;
}

/**
 * Guarda en Redis el resultado de un paso de la guía.
 */
async function guardarResultadoGuia(resultado, userContext) {
  if (resultado.estado) await userContext.setBusquedaGuiada(resultado.estado);
  else await userContext.clearBusquedaGuiada();

  // Mismo orden que ve el cliente: "el primero" y la validación de precios leen de aquí
  await userContext.setUltimosResultados(resultado.productos);
  await userContext.setBusquedaActiva({
    query: resultado.query,
    filtros: resultado.filtros,
    total_resultados: resultado.productos.length,
    mostrados: resultado.mostrados,
    current_page: 1
  });
  await userContext.setUltimaAccion('busqueda_productos');
}

module.exports = {
  debeTratarseComoBusqueda,
  accionAdmiteGuia,
  cantidadPedida,
  detectarAgregadoAmbiguo,
  registrarBusqueda,
  hayProductos,
  iniciarGuia,
  procesarRespuesta,
  guardarResultadoGuia
};
