// ==UserScript==
// @name         网页图片格式转换下载器
// @name:zh-CN   网页图片格式转换下载器
// @name:zh-TW   網頁圖片格式轉換下載器
// @namespace    local.ifrc.image-converter
// @version      1.2.0
// @description  右键网页图片，转换为 PNG、JPG、WebP、AVIF 或 BMP 后下载，支持质量调节、格式可用性检测与图片预览。
// @description:zh-CN 右键网页图片，转换为 PNG、JPG、WebP、AVIF 或 BMP 后下载，支持质量调节、格式可用性检测与图片预览。
// @description:zh-TW 在網頁圖片上按右鍵，可轉換為 PNG、JPG、WebP、AVIF 或 BMP 後下載，支援品質調整、格式可用性偵測與圖片預覽。
// @author       HH2XX
// @homepageURL  https://github.com/HH2XX/ifrc-image-converter
// @supportURL   https://github.com/HH2XX/ifrc-image-converter/issues
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const MENU_ID = 'ifrc-image-format-menu';
    const STYLE_ID = 'ifrc-image-format-style';

    // 与「网页二维码识别器」共用的右键抢占标记，避免两个脚本同时弹菜单。
    // 用 <html> 上的时间戳而不是 Event 属性：Tampermonkey 沙箱之间只有 DOM 一定共享。
    const MENU_CLAIM_ATTR = 'hh2xxMenuClaim';
    const MENU_CLAIM_WINDOW = 60;

    const MAX_CANVAS_PIXELS = 100e6;   // 100MP：超过后多数浏览器的 Canvas 会直接失败
    const MAX_BMP_PIXELS = 24e6;       // 24MP：BMP 需要额外的 3 字节/像素内存

    const DOWNLOAD_TYPES = [
        { label: 'PNG', mime: 'image/png', extension: 'png', detail: '无损 · 支持透明', dot: '#22c55e' },
        { label: 'JPG', mime: 'image/jpeg', extension: 'jpg', detail: '通用 · 体积较小', quality: true, dot: '#f59e0b' },
        { label: 'WebP', mime: 'image/webp', extension: 'webp', detail: '现代格式 · 体积小', quality: true, dot: '#3b82f6' },
        { label: 'AVIF', mime: 'image/avif', extension: 'avif', detail: '高压缩 · 需浏览器支持', quality: true, dot: '#8b5cf6' },
        { label: 'BMP', mime: 'image/bmp', extension: 'bmp', detail: '无损 · 文件较大', bmp: true, dot: '#64748b' }
    ];

    const EXTENSION_BY_MIME = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/avif': 'avif',
        'image/bmp': 'bmp',
        'image/gif': 'gif',
        'image/svg+xml': 'svg',
        'image/x-icon': 'ico'
    };

    const supportCache = Object.create(null);

    let selectedImage = null;
    let menu = null;
    let quality = 0.92;
    let busy = false;

    addStyles();
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', function () {
        // 触发下载时浏览器可能让窗口失焦，此时不要关掉菜单。
        if (!busy) hideMenu();
    });
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', hideMenu);

    /* ---------------------------------------------------------------- 样式 */

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '#' + MENU_ID + '{',
            '--ifrc-fg:CanvasText;--ifrc-muted:GrayText;--ifrc-bd:rgba(128,128,128,.24);',
            '--ifrc-hover:rgba(128,128,128,.10);--ifrc-acc:#4f83f1;--ifrc-acc-soft:rgba(79,131,241,.12);',
            '--ifrc-danger:#b42318;--ifrc-danger-soft:rgba(220,50,47,.10);',
            'position:fixed;z-index:2147483642;width:308px;max-width:calc(100vw - 16px);',
            'max-height:calc(100vh - 16px);overflow:auto;overscroll-behavior:contain;',
            'padding:13px;box-sizing:border-box;border:1px solid var(--ifrc-bd);border-radius:16px;',
            'background:Canvas;color:var(--ifrc-fg);color-scheme:light dark;',
            'box-shadow:0 18px 50px rgba(15,23,42,.26),0 2px 8px rgba(15,23,42,.10);',
            'backdrop-filter:blur(14px) saturate(140%);',
            'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;',
            'animation:ifrc-pop .14s ease-out;}',
            '@keyframes ifrc-pop{from{opacity:0;transform:translateY(-4px) scale(.985);}to{opacity:1;transform:none;}}',
            '@media(prefers-reduced-motion:reduce){#' + MENU_ID + '{animation:none;}}',
            '#' + MENU_ID + ' *{box-sizing:border-box;}',
            '#' + MENU_ID + '::-webkit-scrollbar{width:8px;}',
            '#' + MENU_ID + '::-webkit-scrollbar-thumb{background:rgba(128,128,128,.32);border-radius:99px;}',

            '#' + MENU_ID + ' .ifrc-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:11px;}',
            '#' + MENU_ID + ' .ifrc-preview{',
            'display:flex;align-items:center;justify-content:center;flex:0 0 58px;height:58px;overflow:hidden;',
            'border-radius:10px;border:1px solid var(--ifrc-bd);background-color:rgba(127,127,127,.06);',
            'background-image:linear-gradient(45deg,rgba(127,127,127,.13) 25%,transparent 25%),',
            'linear-gradient(-45deg,rgba(127,127,127,.13) 25%,transparent 25%),',
            'linear-gradient(45deg,transparent 75%,rgba(127,127,127,.13) 75%),',
            'linear-gradient(-45deg,transparent 75%,rgba(127,127,127,.13) 75%);',
            'background-size:12px 12px;background-position:0 0,0 6px,6px -6px,-6px 0;}',
            '#' + MENU_ID + ' .ifrc-preview img{max-width:100%;max-height:100%;object-fit:contain;display:block;}',
            '#' + MENU_ID + ' .ifrc-heading{min-width:0;flex:1;padding-top:1px;}',
            '#' + MENU_ID + ' .ifrc-title{font-size:14px;font-weight:650;letter-spacing:.01em;}',
            '#' + MENU_ID + ' .ifrc-filename{',
            'margin-top:2px;overflow:hidden;color:var(--ifrc-muted);font-size:12px;',
            'text-overflow:ellipsis;white-space:nowrap;}',
            '#' + MENU_ID + ' .ifrc-meta{margin-top:4px;display:flex;flex-wrap:wrap;gap:5px;}',
            '#' + MENU_ID + ' .ifrc-chip{',
            'padding:1px 6px;border-radius:6px;background:var(--ifrc-hover);',
            'color:var(--ifrc-muted);font-size:10px;font-weight:600;letter-spacing:.03em;}',
            '#' + MENU_ID + ' .ifrc-close{',
            'flex:0 0 auto;width:26px;height:26px;padding:0;border:0;border-radius:8px;',
            'background:transparent;color:var(--ifrc-muted);font:18px/1 sans-serif;cursor:pointer;',
            'transition:background .15s,color .15s;}',
            '#' + MENU_ID + ' .ifrc-close:hover{background:var(--ifrc-hover);color:var(--ifrc-fg);}',

            '#' + MENU_ID + ' .ifrc-options{display:grid;grid-template-columns:1fr 1fr;gap:6px;}',
            '#' + MENU_ID + ' .ifrc-option{',
            'position:relative;display:flex;flex-direction:column;gap:1px;align-items:flex-start;',
            'min-height:50px;padding:7px 9px 7px 20px;border:1px solid var(--ifrc-bd);border-radius:10px;',
            'background:transparent;color:inherit;cursor:pointer;text-align:left;font:inherit;',
            'transition:background .15s,border-color .15s,transform .15s;}',
            '#' + MENU_ID + ' .ifrc-option:first-child{grid-column:span 2;}',
            '#' + MENU_ID + ' .ifrc-option:hover:not(:disabled){',
            'background:var(--ifrc-acc-soft);border-color:var(--ifrc-acc);transform:translateY(-1px);}',
            '#' + MENU_ID + ' .ifrc-option:focus-visible{outline:2px solid var(--ifrc-acc);outline-offset:1px;}',
            '#' + MENU_ID + ' .ifrc-option:disabled{opacity:.5;cursor:not-allowed;}',
            '#' + MENU_ID + ' .ifrc-dot{',
            'position:absolute;left:8px;top:13px;width:7px;height:7px;border-radius:50%;',
            'background:var(--dot,#94a3b8);}',
            '#' + MENU_ID + ' .ifrc-format{display:block;font-size:12.5px;font-weight:650;}',
            '#' + MENU_ID + ' .ifrc-detail{display:block;color:var(--ifrc-muted);font-size:10px;line-height:1.35;}',
            '#' + MENU_ID + ' .ifrc-kbd{',
            'position:absolute;right:7px;top:7px;padding:0 4px;border-radius:4px;',
            'border:1px solid var(--ifrc-bd);color:var(--ifrc-muted);font-size:9px;line-height:14px;}',

            '#' + MENU_ID + ' .ifrc-quality{margin-top:11px;padding:9px 10px;border-radius:10px;background:var(--ifrc-hover);}',
            '#' + MENU_ID + ' .ifrc-quality-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;}',
            '#' + MENU_ID + ' .ifrc-quality-row label{font-size:11.5px;font-weight:600;}',
            '#' + MENU_ID + ' .ifrc-quality output{color:var(--ifrc-muted);font-size:11px;font-variant-numeric:tabular-nums;}',
            '#' + MENU_ID + ' input[type=range]{',
            '-webkit-appearance:none;appearance:none;display:block;width:100%;height:4px;margin:0;',
            'border-radius:99px;outline:none;cursor:pointer;',
            'background:linear-gradient(90deg,var(--ifrc-acc) var(--p,92%),rgba(128,128,128,.28) var(--p,92%));}',
            '#' + MENU_ID + ' input[type=range]::-webkit-slider-thumb{',
            '-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#fff;',
            'border:2px solid var(--ifrc-acc);box-shadow:0 1px 3px rgba(0,0,0,.28);}',
            '#' + MENU_ID + ' input[type=range]::-moz-range-thumb{',
            'width:11px;height:11px;border-radius:50%;background:#fff;',
            'border:2px solid var(--ifrc-acc);box-shadow:0 1px 3px rgba(0,0,0,.28);}',
            '#' + MENU_ID + ' .ifrc-quality-hint{margin-top:6px;color:var(--ifrc-muted);font-size:10px;}',

            '#' + MENU_ID + ' .ifrc-foot{',
            'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;',
            'padding-top:9px;border-top:1px solid var(--ifrc-bd);}',
            '#' + MENU_ID + ' .ifrc-tip{color:var(--ifrc-muted);font-size:10px;line-height:1.3;}',
            '#' + MENU_ID + ' .ifrc-original{',
            'flex:0 0 auto;padding:4px 8px;border:1px solid var(--ifrc-bd);border-radius:7px;',
            'background:transparent;color:var(--ifrc-muted);font:inherit;font-size:10.5px;',
            'cursor:pointer;transition:background .15s,color .15s;}',
            '#' + MENU_ID + ' .ifrc-original:hover{background:var(--ifrc-hover);color:var(--ifrc-fg);}',

            '#' + MENU_ID + ' .ifrc-error{',
            'display:none;margin-top:9px;padding:8px 9px;border-radius:9px;',
            'background:var(--ifrc-danger-soft);color:var(--ifrc-danger);',
            'font-size:11px;line-height:1.5;white-space:normal;}',
            '@media(prefers-color-scheme:dark){',
            '#' + MENU_ID + '{--ifrc-acc:#7aa2ff;--ifrc-acc-soft:rgba(122,162,255,.16);',
            '--ifrc-danger:#ff9b90;--ifrc-danger-soft:rgba(248,113,113,.14);}',
            '#' + MENU_ID + ' input[type=range]::-webkit-slider-thumb{background:#1b1f24;}',
            '#' + MENU_ID + ' input[type=range]::-moz-range-thumb{background:#1b1f24;}}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
    }

    /* -------------------------------------------------------------- 事件层 */

    function handleContextMenu(event) {
        // 按住 Shift 保留网页原生右键菜单。
        if (event.shiftKey) {
            hideMenu();
            return;
        }

        const image = findImage(event.target);
        if (!image) {
            hideMenu();
            return;
        }

        // 两个脚本共存时只让一个接管右键，避免菜单重叠。
        if (!claimContextMenu()) {
            hideMenu();
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        selectedImage = image;
        showMenu(event.clientX, event.clientY, image);
    }

    function handleMouseDown(event) {
        if (!menu || menu.contains(event.target)) return;
        hideMenu();
    }

    // 同一次右键在 60ms 内只允许一个脚本抢占，另一个直接让位。
    function claimContextMenu() {
        const root = document.documentElement;
        if (!root || !root.dataset) return true;

        const last = Number(root.dataset[MENU_CLAIM_ATTR] || 0);
        if (last && Date.now() - last < MENU_CLAIM_WINDOW) return false;

        const stamp = String(Date.now());
        root.dataset[MENU_CLAIM_ATTR] = stamp;
        setTimeout(function () {
            if (root.dataset[MENU_CLAIM_ATTR] === stamp) {
                delete root.dataset[MENU_CLAIM_ATTR];
            }
        }, 150);
        return true;
    }

    function handleKeyDown(event) {
        if (!menu) return;

        if (event.key === 'Escape') {
            hideMenu();
            return;
        }

        // 数字键 1-5 快速选择格式。
        if (/^[1-5]$/.test(event.key) && !busy) {
            const buttons = menu.querySelectorAll('.ifrc-option');
            const button = buttons[Number(event.key) - 1];
            if (button && !button.disabled) {
                event.preventDefault();
                event.stopPropagation();
                button.click();
            }
        }
    }

    // 只在菜单外部滚动时关闭；菜单自身内容滚动不受影响。
    function handleScroll(event) {
        if (!menu) return;
        const target = event.target;
        if (target === menu || (target && target.nodeType === 1 && menu.contains(target))) return;
        hideMenu();
    }

    function findImage(target) {
        if (!(target instanceof Element) || target.closest('#' + MENU_ID)) return null;

        const image = target.closest('img');
        if (image && (image.currentSrc || image.src)) return image;

        // 兼容用 CSS background-image 展示的图片。
        let element = target;
        while (element && element !== document.body) {
            const background = getComputedStyle(element).backgroundImage;
            if (background && background !== 'none' && /url\s*\(/i.test(background)) {
                const url = extractBackgroundUrl(background);
                if (url) {
                    return {
                        currentSrc: resolveUrl(url),
                        src: resolveUrl(url),
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
        // 依次匹配双引号、单引号、无引号三种写法，避免贪婪匹配吞掉括号。
        const match = background.match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/i);
        if (!match) return '';
        return (match[1] || match[2] || match[3] || '').trim();
    }

    function resolveUrl(url) {
        try {
            return new URL(url, location.href).href;
        } catch (error) {
            return url;
        }
    }

    /* ---------------------------------------------------------------- 菜单 */

    function showMenu(x, y, image) {
        hideMenu();

        menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-label', '图片格式转换');
        menu.innerHTML =
            '<div class="ifrc-head">' +
            '<div class="ifrc-preview"><img alt=""></div>' +
            '<div class="ifrc-heading">' +
            '<div class="ifrc-title">图片转换</div>' +
            '<div class="ifrc-filename"></div>' +
            '<div class="ifrc-meta"></div>' +
            '</div>' +
            '<button class="ifrc-close" type="button" aria-label="关闭" title="关闭 (Esc)">×</button>' +
            '</div>' +
            '<div class="ifrc-options"></div>' +
            '<div class="ifrc-quality">' +
            '<div class="ifrc-quality-row"><label for="ifrc-quality-range">有损格式质量</label>' +
            '<output>92%</output></div>' +
            '<input id="ifrc-quality-range" type="range" min="60" max="100" step="1" value="92" aria-label="有损格式质量">' +
            '<div class="ifrc-quality-hint">质量越高细节越多，文件通常越大；PNG 与 BMP 不受此设置影响</div>' +
            '</div>' +
            '<div class="ifrc-foot">' +
            '<span class="ifrc-tip">Shift + 右键 可保留网页原菜单</span>' +
            '<button class="ifrc-original" type="button">下载原图</button>' +
            '</div>' +
            '<div class="ifrc-error" role="alert"></div>';

        menu.querySelector('.ifrc-filename').textContent = getImageName(image);
        menu.querySelector('.ifrc-meta').innerHTML = renderMeta(image);

        const preview = menu.querySelector('.ifrc-preview img');
        preview.src = image.currentSrc || image.src;
        preview.addEventListener('error', function () {
            this.style.display = 'none';
        });

        menu.querySelector('.ifrc-close').addEventListener('click', hideMenu);
        menu.querySelector('.ifrc-original').addEventListener('click', function () {
            downloadOriginal(this);
        });

        const qualityInput = menu.querySelector('input[type="range"]');
        const qualityOutput = menu.querySelector('output');
        qualityInput.value = String(Math.round(quality * 100));
        syncQuality(qualityInput, qualityOutput);
        qualityInput.addEventListener('input', function () {
            quality = Number(qualityInput.value) / 100;
            syncQuality(qualityInput, qualityOutput);
        });

        const actions = menu.querySelector('.ifrc-options');
        DOWNLOAD_TYPES.forEach(function (type, index) {
            const supported = isTypeSupported(type);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ifrc-option';
            button.style.setProperty('--dot', type.dot);
            button.disabled = !supported;
            button.innerHTML =
                '<span class="ifrc-dot" aria-hidden="true"></span>' +
                '<span class="ifrc-format"></span>' +
                '<span class="ifrc-detail"></span>' +
                '<span class="ifrc-kbd" aria-hidden="true">' + (index + 1) + '</span>';
            button.querySelector('.ifrc-format').textContent = '下载为 ' + type.label;
            button.querySelector('.ifrc-detail').textContent = supported ? type.detail : '当前浏览器不支持';
            if (!supported) {
                button.title = '当前浏览器不支持编码 ' + type.label;
            } else {
                button.addEventListener('click', function () {
                    convertAndDownload(type, button);
                });
            }
            actions.appendChild(button);
        });

        document.body.appendChild(menu);
        placeMenu(x, y);
    }

    function renderMeta(image) {
        const chips = [];
        chips.push('<span class="ifrc-chip">' + escapeHtml(getOriginalFormat(image)) + '</span>');

        const dimensions = getImageDimensions(image);
        if (dimensions) chips.push('<span class="ifrc-chip">' + escapeHtml(dimensions) + '</span>');

        if (image.isBackgroundImage) chips.push('<span class="ifrc-chip">背景图</span>');
        return chips.join('');
    }

    function syncQuality(input, output) {
        const percent = input.value + '%';
        output.value = percent;
        output.textContent = percent;
        input.style.setProperty('--p', percent);
    }

    function placeMenu(x, y) {
        if (!menu) return;

        const margin = 8;
        menu.style.left = '0px';
        menu.style.top = '0px';

        const rect = menu.getBoundingClientRect();
        let left = x;
        let top = y;

        if (left + rect.width + margin > window.innerWidth) {
            left = Math.max(margin, x - rect.width);
        }
        if (top + rect.height + margin > window.innerHeight) {
            top = Math.max(margin, y - rect.height);
        }

        menu.style.left = Math.round(left) + 'px';
        menu.style.top = Math.round(top) + 'px';
    }

    function hideMenu() {
        if (menu) menu.remove();
        menu = null;
        selectedImage = null;
        busy = false;
    }

    /* ------------------------------------------------------------ 转换下载 */

    async function convertAndDownload(type, clickedButton) {
        if (!selectedImage || !menu || busy) return;

        const image = selectedImage;
        const activeMenu = menu;
        busy = true;

        const buttons = Array.from(menu.querySelectorAll('.ifrc-option'));
        buttons.forEach(function (button) { button.disabled = true; });

        const formatNode = clickedButton.querySelector('.ifrc-format');
        const detailNode = clickedButton.querySelector('.ifrc-detail');
        const originalFormat = formatNode.textContent;
        formatNode.textContent = '正在转换…';
        detailNode.textContent = '请稍候';

        try {
            const blob = await imageToBlob(image, type);
            if (blob.type !== type.mime) {
                throw new Error(type.label + ' 编码不可用，请尝试 PNG、JPG 或 WebP');
            }

            downloadBlob(blob, replaceExtension(getImageName(image), type.extension));

            if (menu === activeMenu) {
                formatNode.textContent = '已下载 ' + type.label;
                detailNode.textContent = formatSize(blob.size);
                busy = false;
                setTimeout(function () {
                    if (menu === activeMenu) hideMenu();
                }, 900);
            }
        } catch (error) {
            console.error('[IFRC] 图片转换失败:', error);
            busy = false;
            if (menu === activeMenu) {
                formatNode.textContent = originalFormat;
                detailNode.textContent = type.detail;
                buttons.forEach(function (button, index) {
                    button.disabled = !isTypeSupported(DOWNLOAD_TYPES[index]);
                });
                showError(getErrorMessage(error));
            }
        }
    }

    async function downloadOriginal(button) {
        const image = selectedImage;
        if (!image || busy) return;

        const url = image.currentSrc || image.src;
        if (!url) return;

        const activeMenu = menu;
        busy = true;
        const label = button.textContent;
        button.disabled = true;
        button.textContent = '读取中…';

        try {
            const blob = /^(data|blob):/i.test(url)
                ? await (await fetch(url)).blob()
                : await requestBlob(url);

            const extension = EXTENSION_BY_MIME[blob.type] || extensionFromUrl(url) || 'png';
            downloadBlob(blob, ensureExtension(getImageName(image), extension));

            if (menu === activeMenu) {
                button.textContent = '已下载 ' + formatSize(blob.size);
                busy = false;
                setTimeout(function () {
                    if (menu === activeMenu) hideMenu();
                }, 900);
            }
        } catch (error) {
            console.error('[IFRC] 原图下载失败:', error);
            busy = false;
            if (menu === activeMenu) {
                button.disabled = false;
                button.textContent = label;
                showError('原图下载失败：' + (error && error.message ? error.message : '未知错误'));
            }
        }
    }

    async function imageToBlob(image, type) {
        const loaded = await loadImageSource(image);
        try {
            const source = loaded.source;
            const width = source.naturalWidth || source.width;
            const height = source.naturalHeight || source.height;
            if (!width || !height) throw new Error('图片没有可用的尺寸信息（可能是 SVG 或未加载完成）');

            const total = width * height;
            if (total > MAX_CANVAS_PIXELS) {
                throw new Error('图片过大（' + formatPixels(total) + '），超出浏览器 Canvas 处理上限');
            }
            if (type.bmp && total > MAX_BMP_PIXELS) {
                throw new Error('BMP 需要逐像素写入，' + formatPixels(total) + ' 的图片请改用 PNG 或 JPG');
            }
            if (width > 65535 || height > 65535) {
                throw new Error('图片单边超过 65535 像素，浏览器无法处理');
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext('2d');
            if (!context) throw new Error('无法创建画布上下文，图片可能过大');

            // JPEG 与 BMP 没有透明通道，把透明区域合成到白色。
            if (type.mime === 'image/jpeg' || type.bmp) {
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, width, height);
            }
            context.drawImage(source, 0, 0, width, height);

            if (type.bmp) return canvasToBmp(context, width, height);

            return await new Promise(function (resolve, reject) {
                canvas.toBlob(function (blob) {
                    if (blob) resolve(blob);
                    else reject(new Error('浏览器无法编码为 ' + type.label));
                }, type.mime, type.quality ? quality : undefined);
            });
        } finally {
            if (loaded.objectUrl) URL.revokeObjectURL(loaded.objectUrl);
        }
    }

    function canvasToBmp(context, width, height) {
        const pixels = context.getImageData(0, 0, width, height).data;
        const rowSize = Math.ceil((width * 3) / 4) * 4;
        const pixelBytes = rowSize * height;
        const buffer = new ArrayBuffer(54 + pixelBytes);
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        view.setUint8(0, 0x42);            // 'B'
        view.setUint8(1, 0x4D);            // 'M'
        view.setUint32(2, buffer.byteLength, true);
        view.setUint32(10, 54, true);      // 像素数据偏移
        view.setUint32(14, 40, true);      // DIB 头长度
        view.setInt32(18, width, true);
        view.setInt32(22, height, true);
        view.setUint16(26, 1, true);       // 平面数
        view.setUint16(28, 24, true);      // 位深
        view.setUint32(34, pixelBytes, true);

        // BMP 行序自下而上，颜色序为 BGR。
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

    /* ------------------------------------------------------------ 图片读取 */

    async function loadImageSource(image) {
        const url = image.currentSrc || image.src;
        if (!url) throw new Error('没有找到图片地址');

        // data:/blob: 地址不需要网络请求。
        if (/^(data|blob):/i.test(url)) {
            return { source: await loadImage(url, false), objectUrl: '' };
        }

        // 先走特权请求：Tampermonkey 不受跨域限制，可读取绝大多数图片。
        try {
            const blob = await requestBlob(url);
            const objectUrl = URL.createObjectURL(blob);
            try {
                const loaded = await loadImage(objectUrl, false);
                return { source: loaded, objectUrl: objectUrl };
            } catch (error) {
                URL.revokeObjectURL(objectUrl);
                throw error;
            }
        } catch (privilegedError) {
            // 兜底：同源图片或带 CORS 头的图片仍可直接加载。
            try {
                return { source: await loadImage(url, true), objectUrl: '' };
            } catch (corsError) {
                throw new Error('浏览器无法读取此图片，可能受防盗链、登录态或临时签名限制');
            }
        }
    }

    function requestBlob(url) {
        return new Promise(function (resolve, reject) {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('脚本缺少 GM_xmlhttpRequest 权限'));
                return;
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                timeout: 20000,
                onload: function (response) {
                    if (response.status >= 200 && response.status < 400 &&
                        response.response instanceof Blob) {
                        resolve(response.response);
                    } else {
                        reject(new Error('读取图片失败 (HTTP ' + response.status + ')'));
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
            image.onload = function () {
                if (!image.naturalWidth && !image.naturalHeight) {
                    reject(new Error('图片解码后尺寸为 0'));
                    return;
                }
                resolve(image);
            };
            image.onerror = function () { reject(new Error('图片加载失败')); };
            image.src = url;
        });
    }

    /* ------------------------------------------------------------ 工具函数 */

    function isTypeSupported(type) {
        if (type.bmp) return true;
        if (type.mime in supportCache) return supportCache[type.mime];

        let supported = false;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            const url = canvas.toDataURL(type.mime);
            supported = typeof url === 'string' && url.indexOf('data:' + type.mime) === 0;
        } catch (error) {
            supported = false;
        }
        supportCache[type.mime] = supported;
        return supported;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.rel = 'noopener';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    function getImageName(image) {
        if (image.isBackgroundImage) {
            return filenameFromUrl(image.src) || 'background';
        }
        return filenameFromUrl(image.currentSrc || image.src) || 'image';
    }

    function filenameFromUrl(rawUrl) {
        try {
            const url = new URL(rawUrl || '', location.href);
            const lastPart = decodeURIComponent(url.pathname.split('/').pop() || '');
            return sanitizeFilename(lastPart);
        } catch (error) {
            return '';
        }
    }

    function extensionFromUrl(rawUrl) {
        try {
            const url = new URL(rawUrl || '', location.href);
            const match = url.pathname.match(/\.([a-z0-9]{2,5})$/i);
            return match ? match[1].toLowerCase() : '';
        } catch (error) {
            return '';
        }
    }

    function getOriginalFormat(image) {
        const extension = extensionFromUrl(image.currentSrc || image.src || '');
        if (extension) return extension.toUpperCase();
        return /^data:image\//i.test(image.src || '') ? 'DATA URI' : '未知格式';
    }

    function getImageDimensions(image) {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        return width && height ? width + ' × ' + height : '';
    }

    function replaceExtension(name, extension) {
        const base = name.replace(/\.[a-z0-9]{1,8}$/i, '') || 'image';
        return base + '.' + extension;
    }

    function ensureExtension(name, extension) {
        return /\.[a-z0-9]{2,5}$/i.test(name) ? name : name + '.' + extension;
    }

    function sanitizeFilename(name) {
        return String(name || '')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/^\.+/, '')
            .slice(0, 180);
    }

    function formatSize(bytes) {
        if (!bytes) return '未知大小';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    }

    function formatPixels(total) {
        return (total / 1e6).toFixed(1) + 'MP';
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
        });
    }

    function getErrorMessage(error) {
        const detail = error && error.message ? error.message : '未知错误';
        return '转换失败：' + detail;
    }

    function showError(message) {
        if (!menu) return;
        const error = menu.querySelector('.ifrc-error');
        error.textContent = message;
        error.style.display = 'block';
        placeMenu(
            parseInt(menu.style.left, 10) || 8,
            parseInt(menu.style.top, 10) || 8
        );
    }
})();
