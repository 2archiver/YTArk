import qrcode from 'qrcode-npm';
const RELEASES_PAGE_PREFIX = 'https://github.com/2archiver/YTArk/releases/';
const qrCache = new Map();
export function qrCodeDataUrl(url) {
  // Only official YTArk release pages are encoded; anything else gets no QR.
  if (typeof url !== 'string' || !url.startsWith(RELEASES_PAGE_PREFIX)) return '';
  if (qrCache.has(url)) return qrCache.get(url);
  let dataUrl = '';
  try {
    const qr = qrcode.qrcode(6, 'M');
    qr.addData(url);
    qr.make();
    const match = qr.createImgTag(6, 8).match(/src="([^"]+)"/);
    dataUrl = match ? match[1] : '';
  } catch (error) {
    console.warn('[YTArk Updates] Could not draw the release page QR code:', error);
  }
  qrCache.set(url, dataUrl);
  return dataUrl;
}
