// ==UserScript==
// @name         网页图片格式转换下载器
// @name:zh-CN   网页图片格式转换下载器
// @name:zh-TW   網頁圖片格式轉換下載器
// @namespace    local.ifrc.image-converter
// @version      1.1.0
// @description  右键网页图片，转换为 PNG、JPG、WebP、AVIF 或 BMP 后下载，支持质量调节与图片预览。
// @description:zh-CN 右键网页图片，转换为 PNG、JPG、WebP、AVIF 或 BMP 后下载，支持质量调节与图片预览。
// @description:zh-TW 在網頁圖片上按右鍵，可轉換為 PNG、JPG、WebP、AVIF 或 BMP 後下載，支援品質調整與圖片預覽。
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const MENU_ID = 'ifrc-image-format-menu';
    const STYLE_ID = 'ifrc-image-format-style';
    const DOWNLOAD_TYPES = [
        { label: 'PNG', mime: 'image/png', extension: 'png', detail: '无损 · 支持透明' },
        { label: 'JPG', mime: 'image/jpeg', extension: 'jpg', detail: '通用 · 体积较小', quality: true },
        { label: 'WebP', mime: 'image/webp', extension: 'webp', detail: '现代格式 · 体积小', quality: true },
        { label: 'AVIF', mime: 'image/avif', extension: 'avif', detail: '高压缩 · 需浏览器支持', quality: true },
        { label: 'BMP', mime: 'image/bmp', extension: 'bmp', detail: '无损 · 文件较大', bmp: true }
    ];

    let selectedImage = null;
    let menu = null;
    let quality = 0.92;

    addStyles();
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', hideMenu);
    window.addEventListener('scroll', hideMenu, true);

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '#' + MENU_ID + ' {' +
            'position:fixed;z-index:2147483647;width:304px;max-width:calc(100vw - 16px);' +
            'max-height:calc(100vh - 16px);overflow:auto;padding:12px;box-sizing:border-box;' +
            'border:1px solid rgba(128,128,128,.25);border-radius:14px;' +
            'background:Canvas;color:CanvasText;box-shadow:0 12px 40px rgba(0,0,0,.24);' +
            'font:13px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;' +
            'color-scheme:light dark;}' +
            '#' + MENU_ID + ' * {box-sizing:border-box;}' +
            '#' + MENU_ID + ' .ifrc-head {display:flex;align-items:center;gap:10px;margin-bottom:11px;}' +
            '#' + MENU_ID + ' .ifrc-preview {' +
            'display:flex;align-items:center;justify-content:center;flex:0 0 62px;height:62px;' +
            'overflow:hidden;border-radius:9px;background-color:rgba(127,127,127,.12);' +
            'background-image:linear-gradient(45deg,rgba(127,127,127,.12) 25%,transparent 25%),' +
            'linear-gradient(-45deg,rgba(127,127,127,.12) 25%,transparent 25%),' +
            'linear-gradient(45deg,transparent 75%,rgba(127,127,127,.12) 75%),' +
            'linear-gradient(-45deg,transparent 75%,rgba(127,127,127,.12) 75%);' +
            'background-size:12px 12px;background-position:0 0,0 6px,6px -6px,-6px 0;}' +
            '#' + MENU_ID + ' .ifrc-preview img {max-width:100%;max-height:100%;object-fit:contain;}' +
            '#' + MENU_ID + ' .ifrc-heading {min-width:0;flex:1;}' +
            '#' + MENU_ID + ' .ifrc-title {font-size:14px;font-weight:650;}' +
            '#' + MENU_ID + ' .ifrc-filename {overflow:hidden;color:GrayText;text-overflow:ellipsis;white-space:nowrap;}' +
            '#' + MENU_ID + ' .ifrc-meta {margin-top:2px;color:GrayText;font-size:11px;}' +
            '#' + MENU_ID + ' .ifrc-close {' +
            'align-self:flex-start;width:28px;height:28px;padding:0;border:0;border-radius:7px;' +
            'background:transparent;color:GrayText;font:20px/1 sans-serif;cursor:pointer;}' +
            '#' + MENU_ID + ' .ifrc-close:hover {background:rgba(127,127,127,.16);}' +
            '#' + MENU_ID + ' .ifrc-options {display:grid;grid-template-columns:1fr 1fr;gap:6px;}' +
            '#' + MENU_ID + ' .ifrc-option {' +
            'min-height:52px;padding:7px 9px;border:1px solid rgba(127,127,127,.2);' +
            'border-radius:9px;background:transparent;color:inherit;cursor:pointer;text-align:left;font:inherit;' +
            'transition:background .15s,border-color .15s,transform .15s;}' +
            '#' + MENU_ID + ' .ifrc-option:hover {background:rgba(80,130,255,.1);border-color:#6d9eff;transform:translateY(-1px);}' +
            '#' + MENU_ID + ' .ifrc-option:disabled {opacity:.55;cursor:wait;transform:none;}' +
            '#' + MENU_ID + ' .ifrc-format {display:block;font-size:13px;font-weight:650;}' +
            '#' + MENU_ID + ' .ifrc-detail {display:block;color:GrayText;font-size:10px;}' +
            '#' + MENU_ID + ' .ifrc-quality {margin-top:12px;padding:9px 10px;border-radius:9px;background:rgba(127,127,127,.09);}' +
            '#' + MENU_ID + ' .ifrc-quality-row {display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;}' +
            '#' + MENU_ID + ' .ifrc-quality output {color:GrayText;font-variant-numeric:tabular-nums;}' +
            '#' + MENU_ID + ' input[type=range] {width:100%;margin:2px 0;accent-color:#4f83f1;}' +
            '#' + MENU_ID + ' .ifrc-quality-hint {color:GrayText;font-size:10px;}' +
            '#' + MENU_ID + ' .ifrc-error {' +
            'display:none;margin-top:9px;padding:8px 9px;border-radius:8px;' +
            'background:rgba(220,50,47,.1);color:#b42318;font-size:11px;white-space:normal;}' +
            '@media(prefers-color-scheme:dark){#' + MENU_ID + ' .ifrc-error{color:#ff8a80;}}';
        (document.head || document.documentElement).appendChild(style);
    }

    function handleContextMenu(event) {
        const image = findImage(event.target);
        if (!image) {
            hideMenu();
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        showMenu(event.clientX, event.clientY, image);
        selectedImage = image;
    }

    function handleMouseDown(event) {
        if (!menu || menu.contains(event.target)) return;
        hideMenu();
    }

    function handleKeyDown(event) {
        if (event.key === 'Escape' && menu) hideMenu();
    }

    function findImage(target) {
        if (!(target instanceof Element) || target.closest('#' + MENU_ID)) return null;

        const image = target.closest('img');
        if (image && (image.currentSrc || image.src)) return image;

        // Support images displayed through CSS backgrounds as well.
        let element = target;
        while (element && element !== document.body) {
            const background = getComputedStyle(element).backgroundImage;
            if (background && background !== 'none' && /url\s*\(/i.test(background)) {
                const url = extractBackgroundUrl(background);
                if (url) {
                    return {
                        currentSrc: url,
                        src: url,
                        alt: 'background-image',
                        isBackgroundImage: true
                    };
                }
            }
            element = element.parentElement;
        }
        return null;
    }

    function extractBackgroundUrl(background) {
        const match = background.match(/url\(\s*["']?([^"')]+)["']?\s*\)/i);
        return match ? match[1] : '';
    }

    function showMenu(x, y, image) {
        hideMenu();
        menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-label', '图片格式转换');
        menu.innerHTML =
            '<div class="ifrc-head">' +
            '<div class="ifrc-preview"><img alt=""></div>' +
            '<div class="ifrc-heading"><div class="ifrc-title">图片转换</div>' +
            '<div class="ifrc-filename"></div><div class="ifrc-meta"></div></div>' +
            '<button class="ifrc-close" type="button" aria-label="关闭" title="关闭 (Esc)">×</button></div>' +
            '<div class="ifrc-options"></div>' +
            '<div class="ifrc-quality">' +
            '<div class="ifrc-quality-row"><label for="ifrc-quality-range">有损格式质量</label>' +
            '<output>92%</output></div>' +
            '<input id="ifrc-quality-range" type="range" min="60" max="100" step="1" value="92" aria-label="有损格式质量">' +
            '<div class="ifrc-quality-hint">质量越高，文件通常越大；PNG 和 BMP 不受影响</div></div>' +
            '<div class="ifrc-error"></div>';
        menu.querySelector('.ifrc-filename').textContent = getImageName(image);
        menu.querySelector('.ifrc-meta').textContent =
            getOriginalFormat(image) + ' · ' + getImageDimensions(image);
        menu.querySelector('.ifrc-preview img').src = image.currentSrc || image.src;
        menu.querySelector('.ifrc-preview img').addEventListener('error', function () {
            this.style.display = 'none';
        });
        menu.querySelector('.ifrc-close').addEventListener('click', hideMenu);

        const qualityInput = menu.querySelector('input[type="range"]');
        const qualityOutput = menu.querySelector('output');
        qualityInput.value = String(Math.round(quality * 100));
        qualityOutput.value = qualityInput.value + '%';
        qualityOutput.textContent = qualityInput.value + '%';
        qualityInput.addEventListener('input', function () {
            quality = Number(qualityInput.value) / 100;
            qualityOutput.value = qualityInput.value + '%';
            qualityOutput.textContent = qualityInput.value + '%';
        });

        const actions = menu.querySelector('.ifrc-options');
        DOWNLOAD_TYPES.forEach(function (type) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ifrc-option';
            button.innerHTML = '<span class="ifrc-format"></span><span class="ifrc-detail"></span>';
            button.querySelector('.ifrc-format').textContent = '下载为 ' + type.label;
            button.querySelector('.ifrc-detail').textContent = type.detail;
            button.addEventListener('click', function () {
                convertAndDownload(type, button);
            });
            actions.appendChild(button);
        });

        document.body.appendChild(menu);
        placeMenu(x, y);
    }

    function placeMenu(x, y) {
        if (!menu) return;
        const rect = menu.getBoundingClientRect();
        const left = Math.min(x, window.innerWidth - rect.width - 8);
        const top = Math.min(y, window.innerHeight - rect.height - 8);
        menu.style.left = Math.max(8, left) + 'px';
        menu.style.top = Math.max(8, top) + 'px';
    }

    async function convertAndDownload(type, clickedButton) {
        if (!selectedImage || !menu) return;

        const image = selectedImage;
        const activeMenu = menu;
        const buttons = Array.from(menu.querySelectorAll('button'));
        buttons.forEach(function (button) { button.disabled = true; });
        clickedButton.querySelector('.ifrc-format').textContent = '正在转换...';

        try {
            const blob = await imageToBlob(image, type);
            if (blob.type !== type.mime) {
                throw new Error(type.label + ' 编码不可用，请尝试 PNG、JPG、WebP 或 BMP');
            }
            downloadBlob(blob, replaceExtension(getImageName(image), type.extension));
            if (menu === activeMenu) {
                clickedButton.querySelector('.ifrc-format').textContent = '已下载 ' + type.label;
                setTimeout(function () {
                    if (menu === activeMenu) hideMenu();
                }, 900);
            }
        } catch (error) {
            console.error('[IFRC] 图片转换失败:', error);
            if (menu === activeMenu) {
                showError(getErrorMessage(error));
                buttons.forEach(function (button) { button.disabled = false; });
                clickedButton.querySelector('.ifrc-format').textContent = '下载为 ' + type.label;
            }
        }
    }

    async function imageToBlob(image, type) {
        const source = await loadImageSource(image);
        try {
            const width = source.naturalWidth || source.width;
            const height = source.naturalHeight || source.height;
            if (!width || !height) throw new Error('图片没有有效尺寸');

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');

            // JPEG and BMP have no alpha channel; composite transparency onto white.
            if (type.mime === 'image/jpeg' || type.bmp) {
                context.fillStyle = '#fff';
                context.fillRect(0, 0, width, height);
            }
            context.drawImage(source, 0, 0, width, height);

            if (type.bmp) return canvasToBmp(canvas);

            return await new Promise(function (resolve, reject) {
                canvas.toBlob(function (blob) {
                    if (blob) resolve(blob);
                    else reject(new Error('浏览器不支持该输出格式'));
                }, type.mime, type.quality ? quality : undefined);
            });
        } finally {
            if (source.objectUrl) URL.revokeObjectURL(source.objectUrl);
        }
    }

    function canvasToBmp(canvas) {
        const width = canvas.width;
        const height = canvas.height;
        const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
        const rowSize = Math.ceil(width * 3 / 4) * 4;
        const pixelBytes = rowSize * height;
        const buffer = new ArrayBuffer(54 + pixelBytes);
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        view.setUint8(0, 0x42);
        view.setUint8(1, 0x4D);
        view.setUint32(2, buffer.byteLength, true);
        view.setUint32(10, 54, true);
        view.setUint32(14, 40, true);
        view.setInt32(18, width, true);
        view.setInt32(22, height, true);
        view.setUint16(26, 1, true);
        view.setUint16(28, 24, true);
        view.setUint32(34, pixelBytes, true);

        for (let y = 0; y < height; y++) {
            const sourceRow = (height - 1 - y) * width * 4;
            const targetRow = 54 + y * rowSize;
            for (let x = 0; x < width; x++) {
                const sourceIndex = sourceRow + x * 4;
                const targetIndex = targetRow + x * 3;
                bytes[targetIndex] = pixels[sourceIndex + 2];
                bytes[targetIndex + 1] = pixels[sourceIndex + 1];
                bytes[targetIndex + 2] = pixels[sourceIndex];
            }
        }
        return new Blob([buffer], { type: 'image/bmp' });
    }

    async function loadImageSource(image) {
        const url = image.currentSrc || image.src;
        if (!url) throw new Error('没有找到图片地址');

        // Existing data/blob URLs can be loaded without a network request.
        if (/^(data|blob):/i.test(url)) return loadImage(url, false);

        // Tampermonkey's privileged request can read many cross-origin images.
        try {
            const blob = await requestBlob(url);
            const objectUrl = URL.createObjectURL(blob);
            try {
                const loaded = await loadImage(objectUrl, false);
                loaded.objectUrl = objectUrl;
                return loaded;
            } catch (error) {
                URL.revokeObjectURL(objectUrl);
                throw error;
            }
        } catch (privilegedError) {
            // Fall back to regular CORS loading when the server permits it.
            return loadImage(url, true);
        }
    }

    function requestBlob(url) {
        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                onload: function (response) {
                    if (response.status >= 200 && response.status < 400 &&
                        response.response instanceof Blob) {
                        resolve(response.response);
                    } else {
                        reject(new Error('读取图片失败 (' + response.status + ')'));
                    }
                },
                onerror: function () { reject(new Error('跨域读取图片失败')); },
                ontimeout: function () { reject(new Error('读取图片超时')); }
            });
        });
    }

    function loadImage(url, useCors) {
        return new Promise(function (resolve, reject) {
            const image = new Image();
            if (useCors) image.crossOrigin = 'anonymous';
            image.onload = function () { resolve(image); };
            image.onerror = function () {
                reject(new Error('浏览器无法读取此图片，可能受网站防盗链限制'));
            };
            image.src = url;
        });
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function getImageName(image) {
        try {
            const url = new URL(image.currentSrc || image.src || '', location.href);
            const lastPart = decodeURIComponent(url.pathname.split('/').pop() || 'image');
            return sanitizeFilename(lastPart) || 'image';
        } catch (error) {
            return 'image';
        }
    }

    function getOriginalFormat(image) {
        const url = image.currentSrc || image.src || '';
        const match = url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i);
        return match ? match[1].toUpperCase() : '未知格式';
    }

    function getImageDimensions(image) {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        return width && height ? width + ' × ' + height : '尺寸读取时显示';
    }

    function replaceExtension(name, extension) {
        const withoutExtension = name.replace(/\.[a-z0-9]{1,8}$/i, '') || 'image';
        return withoutExtension + '.' + extension;
    }

    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180);
    }

    function getErrorMessage(error) {
        const detail = error && error.message ? error.message : '未知错误';
        return '转换失败：' + detail + '。部分网站的防盗链或登录限制可能会阻止读取图片。';
    }

    function showError(message) {
        if (!menu) return;
        const error = menu.querySelector('.ifrc-error');
        error.textContent = message;
        error.style.display = 'block';
        placeMenu(parseInt(menu.style.left, 10) || 8, parseInt(menu.style.top, 10) || 8);
    }

    function hideMenu() {
        if (menu) menu.remove();
        menu = null;
        selectedImage = null;
    }
})();
