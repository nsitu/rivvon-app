// src/modules/textureBrowser.js
// UI component for browsing and selecting remote textures

import { fetchTextures, formatFileSize, formatDate } from './textureService.js';

export class TextureBrowser {
    constructor(options = {}) {
        this.onSelect = options.onSelect || (() => { });
        this.onClose = options.onClose || (() => { });

        this.textures = [];
        this.isLoading = false;
        this.error = null;

        this.modal = null;
        this.listContainer = null;

        this.#createModal();
    }

    #createModal() {
        // Create modal overlay
        this.modal = document.createElement('div');
        this.modal.className = 'texture-browser-overlay';
        this.modal.innerHTML = `
            <div class="texture-browser-modal">
                <div class="texture-browser-header">
                    <h2>Texture Library</h2>
                    <button class="texture-browser-close" title="Close">&times;</button>
                </div>
                <div class="texture-browser-content">
                    <div class="texture-browser-loading">Loading textures...</div>
                    <div class="texture-browser-error" style="display: none;"></div>
                    <div class="texture-browser-list"></div>
                    <div class="texture-browser-empty" style="display: none;">
                        No textures available yet.
                    </div>
                    <div class="texture-browser-create">
                        <p class="create-invite">Created with</p>
                        <a href="https://slyce.rivvon.ca" target="_blank" rel="noopener noreferrer" class="slyce-link">slyce</a>
                        <p class="create-invite">texture builder.</p>
                    </div>
                </div>
            </div>
        `;

        // Get references to elements
        this.listContainer = this.modal.querySelector('.texture-browser-list');
        this.loadingEl = this.modal.querySelector('.texture-browser-loading');
        this.errorEl = this.modal.querySelector('.texture-browser-error');
        this.emptyEl = this.modal.querySelector('.texture-browser-empty');

        // Close button handler
        const closeBtn = this.modal.querySelector('.texture-browser-close');
        closeBtn.addEventListener('click', () => this.close());

        // Close on overlay click (outside modal)
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.close();
            }
        });

        // Close on Escape key
        this.modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });

        // Add to document but keep hidden
        this.modal.style.display = 'none';
        document.body.appendChild(this.modal);
    }

    async open() {
        this.modal.style.display = 'flex';
        this.modal.focus();

        // Load textures if not already loaded
        if (this.textures.length === 0 && !this.isLoading) {
            await this.#loadTextures();
        }
    }

    close() {
        this.modal.style.display = 'none';
        this.onClose();
    }

    async #loadTextures() {
        this.isLoading = true;
        this.error = null;

        this.loadingEl.style.display = 'block';
        this.errorEl.style.display = 'none';
        this.listContainer.style.display = 'none';
        this.emptyEl.style.display = 'none';

        try {
            const result = await fetchTextures({ limit: 100 });
            this.textures = result.textures || [];

            this.loadingEl.style.display = 'none';

            if (this.textures.length === 0) {
                this.emptyEl.style.display = 'block';
            } else {
                this.#renderList();
                this.listContainer.style.display = 'grid';
            }
        } catch (err) {
            console.error('[TextureBrowser] Failed to load textures:', err);
            this.error = err.message;
            this.loadingEl.style.display = 'none';
            this.errorEl.textContent = `Failed to load textures: ${err.message}`;
            this.errorEl.style.display = 'block';
        } finally {
            this.isLoading = false;
        }
    }

    #renderList() {
        this.listContainer.innerHTML = '';

        for (const texture of this.textures) {
            const card = this.#createTextureCard(texture);
            this.listContainer.appendChild(card);
        }
    }

    #createTextureCard(texture) {
        const card = document.createElement('div');
        card.className = 'texture-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        // Calculate size in MB from total_size_bytes
        const sizeMB = texture.total_size_bytes
            ? (texture.total_size_bytes / 1024 / 1024).toFixed(1) + ' MB'
            : null;

        // Owner info
        const ownerHtml = texture.owner_name
            ? `<div class="texture-card-owner">
                ${texture.owner_picture
                ? `<img src="${texture.owner_picture}" alt="${this.#escapeHtml(texture.owner_name)}" class="owner-avatar" />`
                : `<span class="owner-avatar-placeholder"></span>`
            }
                <span class="owner-name">${this.#escapeHtml(texture.owner_name)}</span>
            </div>`
            : '';

        card.innerHTML = `
            <div class="texture-card-thumbnail">
                ${texture.thumbnail_url
                ? `<img src="${texture.thumbnail_url}" alt="${texture.name}" />`
                : `<div class="texture-card-placeholder">
                        <span>${texture.tile_count} tiles</span>
                    </div>`
            }
            </div>
            <div class="texture-card-info">
                <h3 class="texture-card-name">${this.#escapeHtml(texture.name)}</h3>
                ${ownerHtml}
                <div class="texture-card-meta">
                    <span>${texture.tile_count} tiles</span>
                    <span>${texture.tile_resolution}px</span>
                    <span>${texture.cross_section_type || 'waves'}</span>
                    <span>${texture.layer_count} layers</span>
                    ${sizeMB ? `<span>${sizeMB}</span>` : ''}
                </div>
                ${texture.sampled_frame_count && texture.source_frame_count
                ? `<p class="texture-card-frames">Sampled from ${texture.sampled_frame_count} of ${texture.source_frame_count} source frames</p>`
                : texture.source_frame_count
                    ? `<p class="texture-card-frames">Sampled from ${texture.source_frame_count} source frames (subset unknown)</p>`
                    : ''
            }
                ${texture.description
                ? `<p class="texture-card-desc">${this.#escapeHtml(texture.description)}</p>`
                : ''
            }
            </div>
        `;

        // Click handler
        card.addEventListener('click', () => this.#selectTexture(texture));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.#selectTexture(texture);
            }
        });

        return card;
    }

    #selectTexture(texture) {
        console.log('[TextureBrowser] Selected texture:', texture.id, texture.name);
        this.close();
        this.onSelect(texture);
    }

    #escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    destroy() {
        if (this.modal && this.modal.parentNode) {
            this.modal.parentNode.removeChild(this.modal);
        }
    }
}
