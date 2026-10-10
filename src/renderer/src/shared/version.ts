/** Single source of truth — semver + revisión de parche de la misma base */
export const APP_VERSION = '0.10.10'
/** Revisión de la base 0.10.10: a, b, c… (no inflar el patch a .11/.12 por cada hotfix) */
export const APP_REVISION = 'db'
export const APP_NAME = 'KawaiiGPT Robust'
export const APP_LABEL =
  APP_REVISION && APP_REVISION.length
    ? APP_NAME + ' · v' + APP_VERSION + ' rev.' + APP_REVISION
    : APP_NAME + ' · v' + APP_VERSION
