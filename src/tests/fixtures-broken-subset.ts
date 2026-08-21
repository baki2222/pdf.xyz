/**
 * A PDF whose embedded font subset SILENTLY RENDERS BLANK — the negative
 * control for `proveGlyphs`.
 *
 * Produced by `pdf-lib@1.17.1` + `@pdf-lib/fontkit@1.1.1` (the subsetter
 * pdf-lib's own documentation recommends) drawing "机密文件测试" in Noto Sans SC.
 * It is a valid PDF. It opens. Every call that made it returned successfully.
 * Rasterised in Chromium at 3x it produces 1,748 ink pixels and shows the
 * single character 件, against 11,337 pixels and all six characters for the
 * same text through upstream `fontkit@2`.
 *
 * It is checked in because a proof that has never failed is not a proof. Every
 * assertion in `unicode-font.test.ts` — no `.notdef`, no unreadable glyph, no
 * empty outline — would be just as green on a file that draws nothing, unless
 * something demonstrates the predicate can go red. This file is that
 * demonstration, and it is the exact defect rather than a synthetic corruption:
 * a subsetter that writes `loca` offsets pointing at nonsense, with no error
 * raised anywhere.
 *
 * Do not regenerate it. `@pdf-lib/fontkit` is no longer a dependency, which is
 * the point.
 */
export const BROKEN_CJK_SUBSET_PDF_BASE64 =
  "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" +
  "vA5d/+J3UNBD1nqJWNtlOGtwjjqvh/7xTFDzUYtQC1GTa/fqP2VCdFoKZW5kc3RyZWFtCmVu" +
  "ZG9iagoKMTAgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCAyNjMKPj4K" +
  "c3RyZWFtCnicXZDPboMwDMbvPIWP3aGiUKA9oEgFNonD/misDxASwyKNJArhwNsvCaiTFimR" +
  "fv782bHjum1aKSzEH0axDi0MQnKDs1oMQ+hxFDJKUuCC2Z3Cyyaqo9iZu3W2OLVyUFCWEUD8" +
  "6eTZmhUON656fPKxd8PRCDnC4V53IdItWv/ghNLCKSIEOA6u3CvVb3RCiIP12HKnC7senesv" +
  "42vVCGngZPsSUxxnTRkaKkeMypM7pBzcIRFK/k8uNlM/sG9qQnJCoCwu5xsJlDrKq7rY6Oy1" +
  "/HrZKHOUPb/sWu61Jqs2KhxdqyYPPffqvrvf1GMythjjhgrrDNP4OYTEx8a10t7l7y/2Z35n" +
  "CmVuZHN0cmVhbQplbmRvYmoKCjExIDAgb2JqCjw8Ci9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9U" +
  "eXBlIC9PYmpTdG0KL04gNwovRmlyc3QgMzkKL0xlbmd0aCA1OTAKPj4Kc3RyZWFtCnic1VTf" +
  "b9owEH7PX3GP9AHZcULiTAgJCGnRRFuR7oc29cEkXpYJbJQYqfz3u0tgrOu67XVCl+R8d/Z3" +
  "333GBw4CwhACiCWEMAoEjCCKJOBvFEECPo84jMceezjuNbB7VenWY2/rsoXPmMphDY8em9uD" +
  "ceB7k4l3yZ0rp7a28voi8Cn5nHHf2PJQ6AbG2SLLOI8551GIFnEuUnzP0RI0gT7GhMRvtDg8" +
  "Ga7FAefBFGNZb1Hc11C8yx2d6hf4xtyIctI+N5S9/+NcOmvR7yH+hieZeGxly1Q5DYP0jeAi" +
  "4lL4aAGPPl0hHY1Wzv6/zXX4a2te7fDZnDNrnMfyw8Z1Li1yj81UqykC7NY6myvT5vPhWleH" +
  "rWqGSRwKjy1MYcvaVMCWpTaudsfhjcdS3RbalMo4KieZJWeZPdh3psYajbL8WU0XbZLYGk1a" +
  "7OJsrVt7aAqUH+V1eOjjN5BinkgkLpYJ3oPT3uzj3eabLroachdP7jp3REq/QGsrXdZqZp8Q" +
  "J2FCSgFpJLRTY2yHv7sgxum+m+jUzQsOqfGm3qNweqS3aqf/wF62VVULYZ876xEMfZwgPUMJ" +
  "IhESfMklnb/Eq1gXU1NtNeBwpkQxkuRH/Ey4g6GQEpGq/Y2uq68O4iBABk7OKEQnd3r3nurp" +
  "yKzeagHxyzn8oof5MqUViiFq9B7s9TJdqf1l7P+kFqzMjy0iWJovtpsixuvWNUcYTEu70Xjx" +
  "7ppSN6SowXnrK0Ky32/1jlrk3ciek41/dZ1UPiB/Phnejtcfj/3kvgPoMFujCmVuZHN0cmVh" +
  "bQplbmRvYmoKCjEyIDAgb2JqCjw8Ci9TaXplIDEzCi9Sb290IDIgMCBSCi9JbmZvIDMgMCBS" +
  "Ci9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9UeXBlIC9YUmVmCi9MZW5ndGggNTIKL1cgWyAxIDIg" +
  "MiBdCi9JbmRleCBbIDAgMTMgXQo+PgpzdHJlYW0KeJwlybsNACAMxFAnfISUhsXYmrGQICea" +
  "V9jAvU6AMOGiiGpMMPa/TXTrJ9tYSTg8s2sErAplbmRzdHJlYW0KZW5kb2JqCgpzdGFydHhy" +
  "ZWYKMjgxOAolJUVPRg==";
