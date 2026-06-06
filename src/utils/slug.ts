const TRANSLITERATION_MAP: Record<string, string> = {
  'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A', 'Å': 'A', 'Æ': 'AE',
  'Ç': 'C', 'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E', 'Ì': 'I', 'Í': 'I',
  'Î': 'I', 'Ï': 'I', 'Ð': 'D', 'Ñ': 'N', 'Ò': 'O', 'Ó': 'O', 'Ô': 'O',
  'Õ': 'O', 'Ö': 'O', 'Ø': 'O', 'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ü': 'Ue',
  'Ý': 'Y', 'Þ': 'Th', 'ß': 'ss', 'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a',
  'ä': 'ae', 'å': 'a', 'æ': 'ae', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e',
  'ë': 'e', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ð': 'd', 'ñ': 'n',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'oe', 'ø': 'o', 'ù': 'u',
  'ú': 'u', 'û': 'u', 'ü': 'ue', 'ý': 'y', 'þ': 'th', 'ÿ': 'y',
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'з': 'z',
  'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh',
}

/** 一次性编译的音译字符类；原来每次调用都要 new 近百个 RegExp */
const TRANSLITERATION_PATTERN = new RegExp(
  `[${Object.keys(TRANSLITERATION_MAP).join('')}]`,
  'g',
)

export function slug(text: string, separator = '-'): string {
  let result = text.replace(
    TRANSLITERATION_PATTERN,
    char => TRANSLITERATION_MAP[char] ?? char,
  )

  result = result
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, separator)

  return result
}
