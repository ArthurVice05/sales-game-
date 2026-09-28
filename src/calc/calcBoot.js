export function markCalcBootReady(target) {
  target?.__SG_BOOT_READY__?.()
}
