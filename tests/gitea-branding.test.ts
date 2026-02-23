import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

describe('Gitea branding configuration', () => {
  describe('APP_LOGO points to logo.png', () => {
    it('docker-compose.local.yml includes GITEA__ui__APP_LOGO=assets/img/logo.png', () => {
      const content = readFileSync(resolve(ROOT, 'docker-compose.local.yml'), 'utf-8');
      assert.ok(
        content.includes('GITEA__ui__APP_LOGO=assets/img/logo.png'),
        'docker-compose.local.yml should set APP_LOGO to assets/img/logo.png'
      );
    });

    it('aio app.ini template includes APP_LOGO = assets/img/logo.png', () => {
      const content = readFileSync(resolve(ROOT, 'aio/entrypoint.sh'), 'utf-8');
      assert.ok(
        content.includes('APP_LOGO = assets/img/logo.png'),
        'aio entrypoint should set APP_LOGO in app.ini template'
      );
    });

    it('logo.png asset exists in gitea custom public directory', () => {
      const logoPath = resolve(ROOT, 'gitea/custom/public/assets/img/logo.png');
      // readFileSync throws if file doesn't exist
      const buf = readFileSync(logoPath);
      assert.ok(buf.length > 0, 'logo.png should not be empty');
    });
  });

  describe('navbar logo CSS', () => {
    it('extra_links.tmpl contains navbar logo scaling and positioning CSS', () => {
      const content = readFileSync(
        resolve(ROOT, 'gitea/custom/templates/custom/extra_links.tmpl'),
        'utf-8'
      );

      assert.ok(
        content.includes('#navbar-logo > img:nth-child(1)'),
        'should have CSS selector for navbar logo image'
      );
      assert.ok(
        content.includes('transform: scale(3) translateY(4px)'),
        'should scale and translate the logo image'
      );
      assert.ok(
        content.includes('#navbar-logo'),
        'should have CSS selector for navbar-logo container'
      );
      assert.ok(
        content.includes('margin-left: 2.643em'),
        'should set left margin for centering'
      );
      assert.ok(
        content.includes('div.container:nth-child(1)'),
        'should have CSS for container padding'
      );
      assert.ok(
        content.includes('padding-top: 1.2em'),
        'should set top padding on container'
      );
    });
  });

  describe('deploy script handles public assets', () => {
    it('deploy-gitea-templates.sh copies public assets', () => {
      const content = readFileSync(
        resolve(ROOT, 'scripts/deploy-gitea-templates.sh'),
        'utf-8'
      );
      assert.ok(
        content.includes('public/assets/img'),
        'deploy script should copy public assets directory'
      );
      assert.ok(
        content.includes('APP_LOGO'),
        'deploy script should mention APP_LOGO config requirement'
      );
    });
  });
});
