const DEFAULT_COLOR = '#8a97a6'
const SURFACE_COLOR = '#232b36'
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function validHexColor(color, fallback = DEFAULT_COLOR) {
  return COLOR_PATTERN.test(color) ? color : fallback
}

function colorChannels(color) {
  return [1, 3, 5].map((offset) => Number.parseInt(
    color.slice(offset, offset + 2), 16))
}

function colorFromChannels(channels) {
  return `#${channels.map((channel) => Math.round(channel)
    .toString(16).padStart(2, '0')).join('')}`
}

export function mixColors(first, second, amount) {
  const firstChannels = colorChannels(first)
  const secondChannels = colorChannels(second)
  return colorFromChannels(firstChannels.map((channel, index) =>
    channel * (1 - amount) + secondChannels[index] * amount))
}

function relativeLuminance(color) {
  const channels = colorChannels(color).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function contrastRatio(first, second) {
  const brightest = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darkest = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (brightest + 0.05) / (darkest + 0.05)
}

export function readableAccent(color) {
  const accent = validHexColor(color)
  const background = mixColors(SURFACE_COLOR, accent, 0.1)
  for (let amount = 0; amount <= 1; amount += 0.05) {
    const candidate = mixColors(accent, '#ffffff', amount)
    if (contrastRatio(candidate, background) >= 4.5) return candidate
  }
  return '#ffffff'
}

function hashText(value) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function derivedAccent(parentColor, identity) {
  const parent = colorChannels(validHexColor(parentColor))
  const seed = hashText(identity)
  const target = [
    48 + (seed & 127),
    64 + ((seed >>> 8) & 127),
    80 + ((seed >>> 16) & 127),
  ]
  return colorFromChannels(parent.map((channel, index) =>
    channel * 0.35 + target[index] * 0.65))
}

export function taxonomyChipStyle(color) {
  const accent = validHexColor(color)
  const foreground = readableAccent(accent)
  return {
    color: foreground,
    borderColor: `${foreground}88`,
    background: `${accent}1a`,
  }
}
