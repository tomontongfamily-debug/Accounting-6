import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default [
  { ...js.configs.recommended, files:['src/deposit-coverage.js','src/deposit-coverage.jsx','src/totalizer-ocr.js','src/totalizer-image.js','src/phone-reading-sync.js','src/upgrade-components.jsx','src/deposit-cards.jsx','src/shift-health.jsx','src/cash-denominations.jsx','src/mobile-pump-capture.jsx','src/admin-deposits.jsx','pilot/*.mjs','api/pilot/*.js','src/pilot-client.js','src/PilotGate.jsx','src/admin-report-alerts.jsx','src/report-alerts.js','api/_shared/push.js','api/_shared/report-alerts.js','api/notifications/*.js','api/cron/report-alerts.js','src/fuel-leak-loss.js','src/fuel-leak-loss.jsx','src/station-routing.js','src/station-entry-gate.jsx','api/auth/station-session.js','src/store-pages.js','src/store-refresh.js','src/admin-store-gate.jsx','api/_shared/store-page.js','api/_shared/pages.js','api/store/load.js','api/admin/system-health.js'], languageOptions:{globals:{...globals.browser,...globals.node},parserOptions:{ecmaFeatures:{jsx:true}}}, rules:{'no-unused-vars':['error',{varsIgnorePattern:'^[A-Z]',argsIgnorePattern:'^_'}]} },
  ...ts.configs.recommended.map(config=>({...config,files:['src/error-reduction.ts']})),
];
