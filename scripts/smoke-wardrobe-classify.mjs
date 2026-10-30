// Minimal smoke without vitest — run: node --experimental-strip-types scripts/smoke-wardrobe-classify.mjs
import {
  validateWardrobeUpload,
  classifyWardrobeHeuristic,
  parseWardrobeClassifyJson,
  detectWardrobeGiftIntent,
  isSafeForPrimary,
  approveClassifiedToWardrobe,
  filterGalleryByKind,
  canEnterAvatarWardrobe
} from '../src/core/image/wardrobe-classify.ts'

function ok(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('ok', msg)
}

ok(validateWardrobeUpload({ mimeType: 'image/png' }).ok, 'png ok')
ok(!validateWardrobeUpload({ mimeType: 'application/pdf' }).ok, 'pdf reject')
ok(classifyWardrobeHeuristic({ userText: 'vestido en la percha' }).kind === 'garment', 'garment')
ok(classifyWardrobeHeuristic({ userText: 'anillo de plata' }).kind === 'accessory', 'accessory')
ok(detectWardrobeGiftIntent('mira te compre esto para ti').isGift, 'gift')
ok(!isSafeForPrimary('garment'), 'garment not primary')
const patch = approveClassifiedToWardrobe(
  { visualGallery: [], visualImageUrl: 'OLD' },
  {
    dataUrl: 'data:image/png;base64,X',
    classification: classifyWardrobeHeuristic({ userText: 'vestido' }),
    setAsPrimary: true,
    giftFromUser: true,
    source: 'chat_gift'
  }
)
ok(patch.visualImageUrl === 'OLD', 'primary kept')
ok((patch.visualGallery[0]?.tags || []).includes('gift'), 'gift tag')
ok(
  filterGalleryByKind([{ id: '1', tags: ['kind:garment'], role: 'outfit' }], 'garment').length === 1,
  'filter'
)
ok(!canEnterAvatarWardrobe('user_other'), 'user_other out')
const pj = parseWardrobeClassifyJson('{"kind":"scene","confidence":0.88}')
ok(pj?.kind === 'scene', 'parse json')
console.log('ALL PASS')
