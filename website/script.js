/**
 * FoxMC 前台主脚本
 * ============================================================
 * 模块结构（当前启用）：
 *   1. State          —— 跨模块共享状态
 *   2. DOM            —— 安全 DOM / URL 辅助（XSS 防护）
 *   3. LazyReveal     —— 图片懒加载 + 滚动渐显
 *   4. Gallery        —— 相册轮播
 *   5. Nav            —— 移动端导航汉堡菜单
 *   6. ServerStatus   —— 在线人数（status.php）
 *   7. TeamCarousel   —— 团队卡片无缝滚动
 *
 * 入口：DOMContentLoaded → 各模块 init()
 *
 * 备注：页面内容已全部写死在 index.html，本脚本不含后台/CMS 依赖。
 *       原 UserSession / Announce / CMS / ContactForm 四个模块已彻底删除。
 * ============================================================
 */
(function () {
    'use strict';

    // ============================================================
    // 1. State —— 跨模块共享状态
    // ============================================================
    const state = {
        serverIP: 'mc.xm233.cn',
        siteMode: 'international',
        neteaseTierCap: 4,
        // 主 IntersectionObserver，懒加载与团队克隆共用
        io: null,
    };

    // ============================================================
    // 2. DOM —— 安全 DOM / URL 辅助
    // ============================================================
    const $ = (sel) => document.querySelector(sel);

    function escapeHtml(text) {
        // 注意：用 \x26 代替字面量 '&'，避免被某些主机的输出过滤器把
        // '&#39;' 等 HTML 实体反向解码导致脚本语法错误。
        return String(text == null ? '' : text)
            .replace(/&/g,  '\x26amp;')
            .replace(/</g,  '\x26lt;')
            .replace(/>/g,  '\x26gt;')
            .replace(/"/g,  '\x26quot;')
            .replace(/'/g,  '\x26#39;');
    }

    function normalizeMediaUrl(url) {
        if (typeof url !== 'string') return '';
        let value = url.trim().replace(/\\/g, '/');
        const cssUrlMatch = value.match(/^url\((['"]?)(.*?)\1\)$/i);
        if (cssUrlMatch) value = cssUrlMatch[2].trim();
        if (!value || /^(javascript|data):/i.test(value)) return '';
        value = value.replace(/^\.\.\/\.?\//, './');
        if (/^\.\.\/(uploads|png|egg|assets|user\/uploads)\//i.test(value)) value = './' + value.replace(/^\.\.\//, '');
        if (/^admin\/(uploads|assets)\//i.test(value)) value = './' + value;
        if (/^https?:\/\//i.test(value) || value.startsWith('#')) return value;
        if (value.startsWith('./') || value.startsWith('/') || value.startsWith('../')) return value.replace(/ /g, '%20');
        if (/^[A-Za-z0-9_\-./% ]+$/.test(value) && (value.indexOf('/') !== -1 || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(value))) return './' + value.replace(/^\/+/, '').replace(/ /g, '%20');
        return '';
    }

    function safeText(el, text) {
        if (el && text != null) el.textContent = text;
    }

    function safeImgSrc(el, url) {
        if (!el || !url) return;
        const safeUrl = normalizeMediaUrl(url);
        if (!safeUrl) return;

        if (!el.dataset.defaultSrc) {
            const originalSrc = el.getAttribute('data-src') || el.getAttribute('src') || '';
            if (originalSrc && !originalSrc.startsWith('data:')) el.dataset.defaultSrc = originalSrc;
        }
        if (!el.dataset.fallbackBound) {
            el.dataset.fallbackBound = '1';
            el.addEventListener('error', function () {
                const fallback = normalizeMediaUrl(el.dataset.defaultSrc || '');
                if (fallback && el.getAttribute('src') !== fallback) {
                    el.setAttribute('data-src', fallback);
                    el.setAttribute('src', fallback);
                }
            });
        }
        el.setAttribute('data-src', safeUrl);
        el.setAttribute('src', safeUrl);
    }

    function createSafeImg(url, alt, className) {
        const img = document.createElement('img');
        if (className) img.className = className;
        img.alt = alt || '';
        safeImgSrc(img, url);
        return img;
    }

    function safeBg(el, url) {
        if (!el || !url) return;
        const safeUrl = normalizeMediaUrl(url);
        if (!safeUrl) return;
        el.style.backgroundImage = "url('" + safeUrl.replace(/'/g, "\\'") + "')";
        if (el.hasAttribute('data-bg')) el.removeAttribute('data-bg');
    }

    function safeLink(el, url) {
        if (!el || !url) return;
        if (typeof url === 'string') {
            if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('#') || url.startsWith('/')) {
                el.href = url;
            } else if (/^[a-zA-Z0-9]/.test(url) && url.includes('.')) {
                el.href = 'https://' + url;
            }
        }
    }

    // 复制服务器 IP（被 toggle 触发，也供 CMS 重新生成的复制按钮使用）
    function copyServerIP() {
        navigator.clipboard.writeText(state.serverIP).then(() => {
            setTimeout(() => {
                const toggle = document.getElementById('toggle');
                if (toggle) toggle.checked = false;
            }, 2000);
        }).catch(() => {});
    }

    // ============================================================
    // 3. LazyReveal —— 图片懒加载 + 滚动渐显
    // ============================================================
    const lazyReveal = {
        SELECTOR: '[data-src], [data-bg], .scroll-fade-up, .section-header, .spec-card',
        REVEAL_CLASSES: ['scroll-fade-up', 'section-header', 'spec-card'],

        init() {
            if (!('IntersectionObserver' in window)) {
                this._fallback();
                return;
            }
            state.io = new IntersectionObserver((entries, obs) => this._onIntersect(entries, obs), {
                rootMargin: '200px 0px',
                threshold: 0.01,
            });
            document.querySelectorAll(this.SELECTOR).forEach(el => state.io.observe(el));

            // 兜底：hero 区如果未触发观察则强制渐显
            setTimeout(() => {
                document.querySelectorAll('.hero .scroll-fade-up:not(.revealed)').forEach(el => {
                    el.classList.add('revealed');
                });
            }, 300);
        },

        _onIntersect(entries, obs) {
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (!entry.isIntersecting) continue;
                const el = entry.target;

                if (el.tagName === 'IMG' && el.dataset.src) {
                    el.src = el.dataset.src;
                    el.removeAttribute('data-src');
                }
                if (el.dataset.bg) {
                    safeBg(el, el.dataset.bg);
                }
                if (this.REVEAL_CLASSES.some(c => el.classList.contains(c))) {
                    el.classList.add('revealed');
                }
                obs.unobserve(el);
            }
        },

        _fallback() {
            document.querySelectorAll('.scroll-fade-up, .section-header, .spec-card').forEach(el => {
                el.classList.add('revealed');
            });
            document.querySelectorAll('img[data-src]').forEach(img => {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            });
            document.querySelectorAll('[data-bg]').forEach(el => {
                safeBg(el, el.dataset.bg);
            });
        }
    };

    // ============================================================
    // 4. Gallery —— 相册轮播
    // ============================================================
    const gallery = {
        AUTO_INTERVAL: 5000,
        FADE_MS: 300,
        images: [
            { src: './png/f5ea0ca06bf5ac36704b7277536ab53d.jpg', desc: '宏伟的主城大厅' },
            { src: './png/5e1e1be033cbd911e62327519886379f.jpg', desc: '精美的玩家建筑' },
            { src: './png/9cca3afcca8c0a79eac6a39aad5d65ec.jpg', desc: '广阔的生存世界' },
            { src: './egg/img1_bcd004c0.jpg',                    desc: '热闹的活动现场' },
            { src: './egg/img2_ab032cdc.jpg',                    desc: '激情的PVP对战' },
        ],
        currentIndex: 0,
        isTransitioning: false,
        autoPlayTimer: null,
        preloadEnabled: false,
        preloadedSources: new Set(),
        els: {},

        init() {
            this.els.image = document.getElementById('galleryImage');
            this.els.desc  = document.getElementById('galleryDescription');
            this.els.prev  = document.getElementById('prevBtn');
            this.els.next  = document.getElementById('nextBtn');

            this._lazyPreload();

            if (!this._ready()) return;
            this.els.next.addEventListener('click', () => this.next());
            this.els.prev.addEventListener('click', () => this.prev());

            this._startAutoPlay();

            const container = document.querySelector('.gallery-carousel-container');
            if (container) {
                container.addEventListener('mouseenter', () => this._stopAutoPlay(), { passive: true });
                container.addEventListener('mouseleave', () => this._startAutoPlay(), { passive: true });
            }

            // 隐藏标签页时暂停自动播放，节省 CPU
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) this._stopAutoPlay();
                else this._startAutoPlay();
            });
        },

        // 由 CMS 模块调用：用后台数据替换轮播图
        replaceFromCms(items) {
            const next = [];
            (items || []).forEach(g => {
                const src = normalizeMediaUrl(g.src);
                if (src) next.push({ src: src, desc: g.caption });
            });
            if (next.length) {
                this.images = next;
                this.currentIndex = 0;
            }
            if (this.images.length && this.els.image && this.els.desc) {
                safeImgSrc(this.els.image, this.images[0].src);
                this.els.desc.textContent = this.images[0].desc || '';
            }
        },

        next() {
            this.currentIndex = (this.currentIndex + 1) % this.images.length;
            this._update(this.currentIndex);
        },

        prev() {
            this.currentIndex = (this.currentIndex - 1 + this.images.length) % this.images.length;
            this._update(this.currentIndex);
        },

        _ready() {
            return this.els.image && this.els.desc && this.els.prev && this.els.next;
        },

        _update(index) {
            if (this.isTransitioning) return;
            this.isTransitioning = true;
            this.els.image.classList.add('fade-out');
            setTimeout(() => {
                this.els.image.src = this.images[index].src;
                this.els.desc.textContent = this.images[index].desc;
                this.els.image.classList.remove('fade-out');
                this.isTransitioning = false;
                this._preloadNext();
            }, this.FADE_MS);
        },

        _startAutoPlay() {
            this._stopAutoPlay();
            this.autoPlayTimer = setInterval(() => this.next(), this.AUTO_INTERVAL);
        },

        _stopAutoPlay() {
            if (this.autoPlayTimer) {
                clearInterval(this.autoPlayTimer);
                this.autoPlayTimer = null;
            }
        },

        _lazyPreload() {
            const sec = document.getElementById('gallery');
            const doPreload = () => {
                if (this.preloadEnabled) return;
                this.preloadEnabled = true;
                this._preloadNext();
            };
            if (sec && 'IntersectionObserver' in window) {
                const io = new IntersectionObserver((entries, obs) => {
                    if (entries[0].isIntersecting) { doPreload(); obs.unobserve(sec); }
                }, { rootMargin: '400px 0px' });
                io.observe(sec);
            } else if (sec) {
                doPreload();
            }
        },

        _preloadNext() {
            if (!this.preloadEnabled || this.images.length < 2) return;
            const next = this.images[(this.currentIndex + 1) % this.images.length];
            if (!next || this.preloadedSources.has(next.src)) return;
            this.preloadedSources.add(next.src);
            const img = new Image();
            img.src = next.src;
        }
    };

    // ============================================================
    // 5. Nav —— 移动端导航汉堡菜单
    // ============================================================
    const nav = {
        hamburger: null,
        links: null,
        backdrop: null,

        init() {
            this.hamburger = document.querySelector('.hamburger');
            this.links     = document.querySelector('.nav-links');
            if (!this.hamburger || !this.links) return;

            // 注入背景蒙版（仅移动端 CSS 可见），点击即关闭
            this.backdrop = document.createElement('div');
            this.backdrop.className = 'nav-backdrop';
            this.backdrop.setAttribute('aria-hidden', 'true');
            document.body.appendChild(this.backdrop);

            this.hamburger.addEventListener('click', () => this._toggle());
            this.backdrop.addEventListener('click', () => this._setOpen(false));

            // 点击菜单链接后自动关闭
            this.links.addEventListener('click', (e) => {
                if (e.target.tagName === 'A') this._setOpen(false);
            });

            // ESC 关闭 + 视口放大到桌面尺寸时强制恢复
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') this._setOpen(false);
            });
            window.addEventListener('resize', () => {
                if (window.innerWidth > 768) this._setOpen(false);
            });
        },

        _toggle() {
            this._setOpen(!this.links.classList.contains('active'));
        },

        _setOpen(open) {
            this.hamburger.classList.toggle('active', open);
            this.links.classList.toggle('active', open);
            this.backdrop.classList.toggle('active', open);
            document.body.classList.toggle('nav-open', open);
        }
    };

    // ============================================================
    // 6. ServerStatus —— 在线人数
    // ============================================================
    const serverStatus = {
        fetch() {
            const dot       = $('.status-dot');
            const container = $('.status-text');
            const text      = $('.highlight-green');

            // 网易版：固定显示当前山头容量
            if (state.siteMode === 'netease') {
                if (container) {
                    container.textContent = '';
                    container.append('最多可支持 ');
                    const span = document.createElement('span');
                    span.className = 'highlight-green';
                    span.textContent = state.neteaseTierCap;
                    container.appendChild(span);
                    container.append(' 名玩家');
                }
                return;
            }

            if (text) text.textContent = '加载中...';
            fetch('status.php')
                .then(r => r.ok ? r.json() : null)
                .then(res => {
                    if (res && res.success && res.data) {
                        if (text) text.textContent = res.data.p;
                    } else {
                        if (text) text.textContent = '离线';
                        if (dot)  dot.style.backgroundColor = '#ef4444';
                    }
                })
                .catch(() => {
                    if (text) text.textContent = '离线';
                    if (dot) {
                        dot.style.backgroundColor = '#ef4444';
                        dot.style.boxShadow = '0 0 10px #ef4444';
                    }
                });
        }
    };

    // ============================================================
    // 7. TeamCarousel —— 团队卡片无缝滚动
    // ============================================================
    const teamCarousel = {
        init() {
            const wrapper = document.getElementById('teamWrapper');
            if (!wrapper) return;

            // 复制一份卡片用于无缝循环
            const originals = wrapper.querySelectorAll('.team-card');
            for (let i = 0; i < originals.length; i++) {
                const clone = originals[i].cloneNode(true);
                clone.classList.add('team-card-clone');
                wrapper.appendChild(clone);
            }

            // 让懒加载也覆盖到克隆出来的图片
            if (state.io) {
                wrapper.querySelectorAll('img[data-src]').forEach(img => state.io.observe(img));
            }

            // 离开视口时暂停 CSS 动画，节省 CPU
            const section = document.getElementById('team');
            if (section && 'IntersectionObserver' in window) {
                const io = new IntersectionObserver((entries) => {
                    wrapper.style.animationPlayState = entries[0].isIntersecting ? 'running' : 'paused';
                }, { rootMargin: '100px 0px' });
                io.observe(section);
            }
        }
    };

    // ============================================================
    // Entry —— 启动入口
    // ============================================================
    document.addEventListener('DOMContentLoaded', () => {
        // 复制 IP 切换器（与 toggle 联动）
        const toggle = document.getElementById('toggle');
        if (toggle) toggle.addEventListener('change', () => { if (toggle.checked) copyServerIP(); });

        lazyReveal.init();    // 必须先于 teamCarousel，使共享 IO 已就绪
        gallery.init();
        nav.init();
        serverStatus.fetch(); // 在线人数（status.php，无后台依赖）
        teamCarousel.init();
    });
})();
