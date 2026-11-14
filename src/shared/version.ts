/** Single source of truth — semver + revisión de desarrollo sobre la misma base beta */
export const APP_VERSION = '0.12.0-beta'
/** Revisión de desarrollo: a…z, aa… (CHANGELOG + STATUS deben coincidir) */
export const APP_REVISION = 'il'
export const APP_NAME = 'KawaiiGPT Robust'
export const APP_LABEL =
  APP_REVISION && APP_REVISION.length
    ? APP_NAME + ' · v' + APP_VERSION + ' rev.' + APP_REVISION
    : APP_NAME + ' · v' + APP_VERSION
