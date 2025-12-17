// daiko/src/utils/pdf-make.js

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const numeral = require('numeral'); // Importa la librería numeral

const { Buffer } = require('buffer');


function generarPDFCotizacion(data) {
    return new Promise((resolve, reject) => {
        try {
            
            
            // Crear la carpeta si no existe
            const outputDir = path.join(__dirname, 'public/pdf/');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Generar el nombre del archivo basado en la fecha y hora actuales
            const date = new Date();
            const fileName = `Presupuesto_${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}_${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}.pdf`;
            const filePath = path.join(outputDir, fileName);

            const doc = new PDFDocument({ margin: 50 });
            const buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);
                const base64String = pdfBuffer.toString('base64');
                resolve({content: base64String, name: fileName});
            });
            doc.on('error', reject);

            // Crear el archivo PDF en la ruta especificada
            doc.pipe(fs.createWriteStream(filePath));

            // Título
            doc.fontSize(20).text('Cotización', { align: 'left' });

            // Información del cliente
            doc.fontSize(9).text(`Cliente:`, 50, 100)
                .text(`Razón social: ${data.cliente.RAZON_SOCIAL}`, { align: 'left' })
                .text(`Dirección: ${data.cliente.CALLE}`, { align: 'left' })
                .text(`RFC: ${data.cliente.RFC_CURP}`, { align: 'left' })
                .text(`At’n: ${data.cliente.CONTACTO_PRINCIPAL}`, { align: 'left' });

            // Información de la cotización
            doc.fontSize(8).text(`Fecha: ${data.FECHA}`, 400, 100)
                .text(`Folio: ${data.FOLIO}`, { align: 'left' });

            // Vigencia y Condiciones
            
            //doc.text(`Vigencia: ${data.vigencia}`, 50, 160)
            //    .text(`Condiciones: ${data.condiciones}`, { align: 'left' });
            

            // Información del vendedor
            doc.text(`Vendedor: ${data.VENDEDOR_NOMBRE}`, 400, 160);

            // Fondo verde para los títulos de la tabla
            const headerY = 200;
            doc.rect(40, headerY - 7, 520, 20) // Dibujar un rectángulo verde detrás de los títulos
                .fillColor('#008000') // Establecer el color de relleno a verde
                .fill();

            // Resetear el color de texto a negro
            doc.fillColor('#FFFFFF');

            // Tabla de productos
            doc.fontSize(9).text('Artículo', 50, 200)
                .text('Descripción', 100, 200)
                .text('U. Med.', 300, 200)
                .text('Uni', 350, 200)
                .text('Precio', 400, 200)
                .text('Descto.', 450, 200)
                .text('Importe', 500, 200);

            // Resetear el color de relleno a negro para el resto del texto
            doc.fillColor('#000000');

            let y = 220;
            data.articulos.forEach(item => {
                doc.fontSize(8).text(item.ARTICULO_ID, 50, y)
                    .text(item.NOMBRE, 100, y)
                    .text("", 300, y)
                    .text(item.UNIDADES, 350, y)
                    .text(`${numeral(item.PRECIO_UNITARIO).format('$0,0.00')}`, 400, y)
                    .text(`${numeral(item.DESCUENTO).format('$0,0.00')}`, 450, y)
                    .text(`${numeral(item.UNIDADES * item.PRECIO_UNITARIO ).format('$0,0.00')}`, 500, y);
                y += 20;
            });

            // Totales y observaciones
            // Columna 1
            y += 40; // Ajustar la posición vertical antes de empezar las columnas
            const x1 = 400;
            doc.fontSize(9)
                .text(`Moneda: `, x1, y)
                .text(`Importe neto: `, x1, y + 10)
                .text(`Subtotal: `, x1, y + 20)
                .text(`Descuento: `, x1, y + 30)
                .text(`Dscto Extra: `, x1, y + 40)
                .text(`Fletes: `, x1, y + 50)
                .text(`Otros cargos: `, x1, y + 60)
                .text(`IVA 16%: `, x1, y + 70)
                .fontSize(14)
                .text(`Total: `, x1, y + 90);

            // Columna 2
            const x2 = 460;
            doc.fontSize(9)
                .text(` ${data.MONEDA_NOMBRE || '--'}`, x2, y, { align: 'right' })
                .text(` ${numeral(data.IMPORTE_NETO).format('$0,0.00')}`, x2, y + 10, { align: 'right' })
                
                //.text(` ${numeral(data.subtotal).format('$0,0.00')}`, x2, y + 20, { align: 'right' })
                //.text(` ${numeral(data.descuento).format('$0,0.00')}`, x2, y + 30, { align: 'right' })
                //.text(` ${numeral(data.dsctoExtra).format('$0,0.00')}`, x2, y + 40, { align: 'right' })
                //.text(` ${numeral(data.fletes).format('$0,0.00')}`, x2, y + 50, { align: 'right' })
                //.text(` ${numeral(data.otrosCargos).format('$0,0.00')}`, x2, y + 60, { align: 'right' })
                //.text(` ${numeral(data.iva).format('$0,0.00')}`, x2, y + 70, { align: 'right' })        
                //.fontSize(11)
                //.text(` ${numeral(data.total).format('$0,0.00')}`, x2, y + 90, { align: 'right' });
                

            // Observaciones
            //doc.fontSize(7).text(`Observaciones: ${data.observaciones}`, 50, y + 20);

            doc.end();
            
        } catch (error) {
            reject(error);
        }
    });
}


module.exports = { generarPDFCotizacion };