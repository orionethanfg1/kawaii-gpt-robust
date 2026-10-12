/** Single source of truth — semver + revisión de parche de la misma base */
export const APP_VERSION = '0.11.1-beta'
/** Revisión de hotfixes sobre la misma base (a, b, c…). Vacío en el tag de beta. */
export const APP_REVISION = ''
export const APP_NAME = 'KawaiiGPT Robust'
export const APP_LABEL =
  APP_REVISION && APP_REVISION.length
    ? APP_NAME + ' · v' + APP_VERSION + ' rev.' + APP_REVISION
    : APP_NAME + ' · v' + APP_VERSION
