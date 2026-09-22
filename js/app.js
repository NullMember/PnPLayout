// Bootstraps the "Generate PDF" button: reads the sidebar options, builds the
// pdf-lib document page by page (interleaving front/back pages and flipping
// back pages), then offers the result as a download. Surfaces progress via
// the shared .status box in addition to the existing console.log trail.

function setStatus(message, type = 'info') {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
}

document.getElementById('generatePdf').addEventListener('click', async () => {
    console.log('Generate PDF button clicked');
    const downloadLink = document.getElementById('downloadLink');
    downloadLink.classList.remove('show');

    if (images1.length === 0 && images2.length === 0) {
        setStatus('Add at least one front or back image first.', 'error');
        return;
    }

    setStatus('Generating PDF...', 'processing');

    try {
        const pdfDoc = await PDFLib.PDFDocument.create();
        const dpi = parseInt(document.getElementById('dpiInput').value);
        const marginTop = parseFloat(document.getElementById('marginTop').value);
        const marginBottom = parseFloat(document.getElementById('marginBottom').value);
        const marginLeft = parseFloat(document.getElementById('marginLeft').value);
        const marginRight = parseFloat(document.getElementById('marginRight').value);

        const PAGE_WIDTH = document.getElementById('paperSize').value === 'A4' ? A4_WIDTH : LETTER_WIDTH;
        const PAGE_HEIGHT = document.getElementById('paperSize').value === 'A4' ? A4_HEIGHT : LETTER_HEIGHT;

        const crosshairFront = document.getElementById('crosshairFront').checked;
        const crosshairBack = document.getElementById('crosshairBack').checked;

        const border = document.getElementById('borderEnabled').checked;

        let oddImages = images1.sort((a, b) => a.name.localeCompare(b.name));
        let evenImages = images2.sort((a, b) => a.name.localeCompare(b.name));

        let pageIndex = 0;

        while (oddImages.length > 0 || evenImages.length > 0) {
            // Add odd page
            if (oddImages.length > 0) {
                const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
                await drawImagesOnPage(pdfDoc, page, oddImages, dpi, marginTop, marginBottom, marginLeft, marginRight, crosshairFront, border);
                pageIndex++;
            }

            // Add even page
            if (evenImages.length > 0) {
                const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
                await drawImagesOnPage(pdfDoc, page, evenImages, dpi, marginTop, marginBottom, marginLeft, marginRight, crosshairBack, border);
                await flipPageHorizontally(pdfDoc, pageIndex);
                pageIndex++;
            }
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        downloadLink.href = url;
        downloadLink.download = 'images.pdf';
        downloadLink.classList.add('show');
        downloadLink.textContent = 'Download PDF';
        console.log('PDF generation completed');
        setStatus(`Done — ${pageIndex} page(s) generated.`, 'success');
    } catch (error) {
        console.error(error);
        setStatus(`Error: ${error.message}`, 'error');
    }
});
