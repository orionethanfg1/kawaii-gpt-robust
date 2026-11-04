/**
 * Host capability answers (music / image) without calling the LLM.
 */
export function musicCapabilityReply(musicEnabled: boolean): string {
  return musicEnabled
    ? `Sí — puedo generar canciones con la capa de música (ACE-Step local). Dime un estilo o tema, por ejemplo: «genera una canción pop sobre un viaje» o «haz una balada suave». La primera vez el motor puede tardar en arrancar.`
    : `Puedo generar música, pero la capa está desactivada. Actívala en Ajustes → Capas → Música (o di «activa la música» si el control de app está disponible) y luego pídeme una canción concreta.`
}

export function imageCapabilityReply(imageEnabled: boolean, mode: string): string {
  return imageEnabled
    ? `Sí — puedes pedirme imágenes en el chat (p. ej. «dibuja un gato» o «genera una imagen tuya»). Modo: ${mode}.`
    : `La generación de imágenes está desactivada. Actívala en Ajustes.`
}
