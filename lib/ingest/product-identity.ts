export type DocumentStamp = { doc: number; t: number };

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Revisions and re-filings of the same product share a key; unnamed products never merge. */
export function productKey(maker: string, productName: string, doc: number) {
  const name = normalize(productName);
  return name ? `${normalize(maker)}|${name}` : `doc:${doc}`;
}

export function isNewerDocument(candidate: DocumentStamp, current: DocumentStamp) {
  return candidate.t > current.t || (candidate.t === current.t && candidate.doc > current.doc);
}
