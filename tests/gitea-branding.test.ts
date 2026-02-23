import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

describe('Gitea branding configuration', () => {
  describe('custom logo assets', () => {
    it('logo.png exists in gitea custom public directory', () => {
      const logoPath = resolve(ROOT, 'gitea/custom/public/assets/img/logo.png');
      const buf = readFileSync(logoPath);
      assert.ok(buf.length > 1000, 'logo.png should be a real image (not empty)');
    });

    it('favicon.png exists in gitea custom public directory', () => {
      const faviconPath = resolve(ROOT, 'gitea/custom/public/assets/img/favicon.png');
      const buf = readFileSync(faviconPath);
      assert.ok(buf.length > 1000, 'favicon.png should be a real image');
    });

    it('no SVG wrappers exist (they break when loaded via <img> tag)', () => {
      const logoSvg = resolve(ROOT, 'gitea/custom/public/assets/img/logo.svg');
      const faviconSvg = resolve(ROOT, 'gitea/custom/public/assets/img/favicon.svg');
      assert.ok(!existsSync(logoSvg), 'logo.svg should not exist — SVG wrappers with embedded PNGs break in <img> tags');
      assert.ok(!existsSync(faviconSvg), 'favicon.svg should not exist');
    });
  });

  describe('navbar template uses logo.png', () => {
    it('head_navbar.tmpl references logo.png instead of logo.svg', () => {
      const content = readFileSync(
        resolve(ROOT, 'gitea/custom/templates/base/head_navbar.tmpl'),
        'utf-8'
      );
      assert.ok(
        content.includes('/img/logo.png'),
        'navbar template should reference logo.png'
      );
      assert.ok(
        !content.includes('/img/logo.svg'),
        'navbar template should NOT reference logo.svg'
      );
    });

    it('head_navbar.tmpl is a full template (not stripped)', () => {
      const content = readFileSync(
        resolve(ROOT, 'gitea/custom/templates/base/head_navbar.tmpl'),
        'utf-8'
      );
      assert.ok(
        content.includes('<nav id="navbar"'),
        'navbar template should contain the full navigation markup'
      );
      assert.ok(
        content.includes('navbar-logo'),
        'navbar template should contain the logo element'
      );
    });
  });

  describe('AIO entrypoint template symlinks', () => {
    const entrypoint = readFileSync(resolve(ROOT, 'aio/entrypoint.sh'), 'utf-8');

    it('symlinks templates to /data/gitea/custom/templates (not /data/gitea/templates)', () => {
      assert.ok(
        entrypoint.includes('TEMPLATE_DIR="/data/gitea/custom/templates"'),
        'entrypoint should symlink templates to the correct Gitea custom path'
      );
      assert.ok(
        !entrypoint.includes('TEMPLATE_DIR="/data/gitea/templates"'),
        'entrypoint should NOT use the wrong legacy path /data/gitea/templates'
      );
    });

    it('cleans up legacy wrong-path symlink', () => {
      assert.ok(
        entrypoint.includes('/data/gitea/templates'),
        'entrypoint should reference the legacy path for cleanup'
      );
      assert.ok(
        entrypoint.includes('rm -f "/data/gitea/templates"'),
        'entrypoint should remove the legacy symlink if it exists'
      );
    });

    it('does not set invalid APP_LOGO config key', () => {
      // APP_LOGO is not a valid Gitea config key — logo is customized via
      // template override + custom public assets directory instead
      assert.ok(
        !entrypoint.includes('APP_LOGO'),
        'entrypoint should NOT set APP_LOGO (not a valid Gitea config key)'
      );
    });
  });
});
