function normalizeBarcode(value) {
  const code = String(value || "").trim();
  return /^\d{1,7}$/.test(code) ? code.padStart(8, "0") : code;
}

function modelText(value) {
  return String(value || "").toUpperCase()
    .replace(/\b(NRC-?)IM\b/g, (_, prefix) => prefix + "1M")
    .replace(/\b(NTMRC15-?)IG\b/g, (_, prefix) => prefix + "1G")
    .replace(/\b(CPC-?6Q)[I1]\b/g, (_, prefix) => prefix + "I")
    .replace(/\b(?:NTM-?(?:PM|MP)|MP)15SS3\b/g, "NTM-MP15SS3")
    .replace(/([A-Z0-9])-\s+([A-Z0-9])/g, "$1-$2");
}

function modelTokens(value, preserveHyphens = false) {
  const tokens = modelText(value).matchAll(/([A-Z0-9]+(?:-[A-Z0-9]+)*)(?:\s*\(\s*(\d{1,2})\s*\))?/g);
  const models = new Set();
  for (const [, printed, variant] of tokens) {
    const token = preserveHyphens ? printed : printed.replace(/-/g, "");
    if (token.length < 4 || !/[A-Z]/.test(token) || !/\d/.test(token) ||
      /^(?:BUY|GET|TAKE)\d+$|^\d+(?:MOS?|MONTHS?|HP|LITER|LITRE|INCH|FT)$/.test(token)) continue;
    models.add(variant ? token + "(" + variant + ")" : token);
  }
  return [...models];
}

function brandKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function matchingModel(row, catalog) {
  const description = String(row.description || "").toUpperCase();
  const models = modelTokens(description);
  if (!models.length) return null;
  const matches = [...new Set(models.flatMap(model => catalog.models.get(model) || []))];
  if (!matches.length) return null;
  const words = description.replace(/[^A-Z0-9]+/g, " ").trim();
  const hasNamedBrand = [...catalog.brands].some(brand => (` ${words} `).includes(` ${brand} `));
  const mentionedBrands = new Set(matches.map(product => brandKey(product.brand))
    .filter(brand => brand.length >= 3 && (` ${words} `).includes(` ${brand} `)));
  if (mentionedBrands.size > 1) return null;
  if (hasNamedBrand && !mentionedBrands.size) return null;
  const branded = matches.filter(product => mentionedBrands.has(brandKey(product.brand)));
  let selected = mentionedBrands.size ? branded : matches;
  if (selected.length > 1 && mentionedBrands.size === 1) {
    // The catalog can carry different barcodes for models such as NRC1M and NRC-1M.
    const printedModels = new Set(modelTokens(description, true));
    const exact = selected.filter(product => modelTokens(product.model_description, true)
      .some(model => printedModels.has(model)));
    if (exact.length) selected = exact;
    if (selected.length > 1 && !description.includes("/")) {
      const standalone = selected.filter(product => modelTokens(modelText(product.model_description)
        .replace(/[A-Z0-9-]+\/[A-Z0-9-]+/g, ""), exact.length > 0)
        .some(model => exact.length ? printedModels.has(model) : models.includes(model)));
      if (standalone.length === 1) selected = standalone;
    }
  }
  if (selected.length !== 1) return null;
  const product = selected[0];
  if (!normalizeBarcode(product.barcode)) return null;
  return product;
}

function matchingBuyGetBundle(row, catalog) {
  const excerpt = String(row.sourceColumns
    ? [row.description, row.model, row.category, row.remarks].join(" ") : row.sourceExcerpt || "").toUpperCase();
  if (/\b(?:FREE|WITH|AND|ASSORTED|CHOOSE)\b|[+&/]/.test(excerpt)) return null;
  const terms = [...excerpt.matchAll(/\bBUY\s*(\d{1,2})\s+(?:GET|TAKE)\s*(\d{1,2})\b/g)];
  if (!terms.length) return null;
  const quantities = [...new Set(terms.map(match => `${Number(match[1])}:${Number(match[2])}`))];
  if (quantities.length !== 1) return null;
  const [paid, free] = quantities[0].split(":").map(Number);
  if (!paid || !free) return null;
  const models = modelTokens(row.sourceColumns ? row.description : `${row.description} ${row.sourceExcerpt}`);
  if (models.length !== 1) return null;
  const product = matchingModel(row, catalog) || matchingHouseFan(row.description, catalog) ||
    matchingSpacedModel(row.description, catalog);
  if (!product || product.srp == null || !Number.isFinite(Number(product.srp)) || Number(product.srp) <= 0) return null;
  const barcode = normalizeBarcode(product.barcode);
  return [
    { id: "paid", barcode, quantity: paid, free: false },
    { id: "free", barcode, quantity: free, free: true },
  ];
}

function matchingHouseFan(description, catalog) {
  const model = description.match(/\b1MS[ -]+([A-Z]{2})\b/i);
  if (!model || !/\bMEGASAVER\s*(?:(?:STAND|DESK)\s+)?FAN\b/i.test(description)) return null;
  const fans = catalog.models.get(("1MS" + model[1]).toUpperCase()) ?? [];
  return fans.length === 1 && brandKey(fans[0].brand) === "CAMEL" && /\bfan\b/i.test(fans[0].model_description)
    ? fans[0] : null;
}

function matchingSpacedModel(description, catalog) {
  const [model] = modelTokens(description, true);
  if (!model || model.includes("(") || catalog.models.has(model.replace(/-/g, ""))) return null;
  const text = modelText(description);
  const printed = text.match(new RegExp("\\b" + model + "\\s+([A-Z]{2,4})\\b"));
  if (!printed) return null;
  const joined = printed[0].replace(/\s+/g, "-");
  return matchingModel({ description: text.replace(printed[0], joined) }, catalog);
}

function matchingCombination(row, catalog) {
  if (!row.sourceColumns || /\b(?:BUY|GET|TAKE)\s*\d|\bB\dT\d\b|\bFREE\b/i.test(row.description)) return null;
  // A number in parentheses can identify a catalog variant. Other quantity notes require review.
  const text = modelText(row.description).replace(/\b(?=[A-Z0-9-]*\d)[A-Z0-9-]+\s*\(\s*\d{1,2}\s*\)/g, "");
  if (/\(\s*\d+\s*\)/.test(text)) return null;
  return matchingIndividualCombination(row.description, catalog) || matchingPackedCombination(row.description, catalog);
}

function matchingIndividualCombination(description, catalog) {
  // A slash often separates model codes after a combined item name such as
  // "RICE COOKER & KETTLE RC-87/EK-017". Keep that descriptive ampersand together.
  let parts = description.split(/[+/]/).map(value => value.trim());
  if (parts.length < 2) parts = description.split(/&/).map(value => value.trim());
  if (parts.length < 2 || parts.some(part => !part)) return null;
  const components = [];
  let brand = "";
  for (const printedPart of parts) {
    const part = separateJoinedBrand(printedPart, catalog);
    const words = part.toUpperCase().replace(/[^A-Z0-9]+/g, " ");
    const brands = [...catalog.brands].filter(value => (" " + words + " ").includes(" " + value + " "));
    if (brands.length > 1) return null;
    if (brands.length) brand = brands[0];
    const product = matchingModel({ description: brand + " " + part }, catalog) ||
      matchingSpacedModel(brand + " " + part, catalog);
    // Every printed combination part must name exactly one uniquely matched model.
    if (!product || modelTokens(part).length !== 1 || !Number.isFinite(Number(product.srp)) || Number(product.srp) <= 0) return null;
    components.push({ id: "product-" + (components.length + 1), barcode: normalizeBarcode(product.barcode), quantity: 1, free: false });
  }
  return components;
}

function bundleModelKey(models) {
  return [...models].sort().join("/");
}

function matchingPackedCombination(description, catalog) {
  const parts = description.split("+").map(part => part.trim());
  if (parts.length < 2 || !parts.some(part => part.includes("/"))) return null;
  const products = parts.map(part => {
    if (part.includes("/")) {
      const groups = part.split("/").map(value => modelTokens(value));
      if (groups.some(group => group.length !== 1)) return null;
      const models = groups.flat();
      if (new Set(models).size !== models.length) return null;
      const words = " " + brandKey(part) + " ";
      const matches = (catalog.packedBundles.get(bundleModelKey(models)) ?? [])
        .filter(product => words.includes(" " + brandKey(product.brand) + " "));
      return matches.length === 1 ? matches[0] : null;
    }
    const modelPart = separateJoinedBrand(part, catalog);
    const matches = modelTokens(modelPart);
    if (matches.length === 1) {
      const product = matchingModel({ description: modelPart }, catalog);
      if (product) return product;
    }
    return matchingHouseFan(part, catalog);
  });
  if (products.some(product => !product || !normalizeBarcode(product.barcode) ||
    !Number.isFinite(Number(product.srp)) || Number(product.srp) <= 0)) return null;
  return products.map((product, index) => ({
    id: "product-" + (index + 1), barcode: normalizeBarcode(product.barcode), quantity: 1, free: false,
  }));
}

function separateJoinedBrand(part, catalog) {
  const models = modelTokens(part, true);
  if (models.length !== 1) return part;
  const [token] = models;
  if (catalog.models.has(token.replace(/-/g, ""))) return part;
  // Some offers print the brand and model together, for example CAMELCRC-1002S.
  const brands = [...catalog.brands].filter(brand => {
    if (!token.startsWith(brand)) return false;
    const model = token.slice(brand.length).replace(/-/g, "");
    return catalog.models.get(model)?.some(product => brandKey(product.brand) === brand);
  });
  if (brands.length !== 1) return part;
  const [brand] = brands;
  return part.toUpperCase().replace(token, brand + " " + token.slice(brand.length));
}

export function matchPromotionComponents(candidates, products) {
  const productByCode = new Map();
  const productsByDescription = new Map();
  const catalog = { models: new Map(), packedBundles: new Map(), brands: new Set() };
  for (const product of products) {
    const code = normalizeBarcode(product.barcode);
    if (!productByCode.has(code)) productByCode.set(code, []);
    productByCode.get(code).push(product);
    const description = product.model_description || "";
    const descriptionKey = brandKey(description);
    if (!productsByDescription.has(descriptionKey)) productsByDescription.set(descriptionKey, []);
    productsByDescription.get(descriptionKey).push(product);
    const packed = /\bBUNDLE\b/i.test(description);
    const multiBuy = /\b(?:BUY\s*\d|B\dT\d)\b/i.test(description);
    const models = modelTokens(description);
    if (packed && !multiBuy && models.length > 1) {
      const key = bundleModelKey(models);
      if (!catalog.packedBundles.has(key)) catalog.packedBundles.set(key, []);
      catalog.packedBundles.get(key).push(product);
    }
    for (const model of packed || multiBuy ? [] : models) {
      if (!catalog.models.has(model)) catalog.models.set(model, []);
      catalog.models.get(model).push(product);
    }
    const brand = brandKey(product.brand);
    if (brand.length >= 3) catalog.brands.add(brand);
  }
  return candidates.map(row => {
    const code = normalizeBarcode(row.barcode);
    const matches = productByCode.get(code) || [];
    const reasons = [];
    if (!code) reasons.push("Barcode is missing.");
    if (!row.description) reasons.push("Description is missing.");
    const sourceTerms = row.sourceColumns
      ? [row.description, row.category, row.remarks].join(" ") : `${row.sourceName} ${row.sourceExcerpt}`;
    const hasBundleTerms = /\b(?:bundle|buy\s*\d|buy\s+one|get\s*\d|get\s+one|B\dT\d)\b/i.test(sourceTerms) ||
      (/^GRAB FOR ONLY\s+\d/i.test(row.description) && /[+/]/.test(row.description)) ||
      (!row.sourceColumns && /\bfree\b/i.test(sourceTerms));
    const bundle = hasBundleTerms ? matchingBuyGetBundle(row, catalog) || matchingCombination(row, catalog) : null;
    const simpleTerms = !/\b(?:set|pack|pair|pcs?|pieces?|units?|with|and|assorted|choose)\b|[+&]/i.test(row.description);
    const matchingRow = { ...row, description: [row.brand, row.description].filter(Boolean).join(" ") };
    const exactDescription = !hasBundleTerms && matches.length === 0
      ? productsByDescription.get(brandKey(row.description)) ?? [] : [];
    const matchedModel = exactDescription.length === 1 ? exactDescription[0]
      : !hasBundleTerms && simpleTerms && matches.length === 0 && modelTokens(row.description).length === 1
        ? matchingModel(matchingRow, catalog) : null;
    const product = matches.length === 1 ? matches[0] : matchedModel;
    const stockedMultiBuy = hasBundleTerms && matches.length === 1 &&
      /\b(?:BUY\s*\d+\s+(?:GET|TAKE)\s*\d+|B\dT\d)\b/i.test(row.description) &&
      brandKey(row.description).split(" ").sort().join(" ") ===
        brandKey(product.model_description).split(" ").sort().join(" ");
    // A matching catalog barcode can represent the whole set as one stocked unit.
    const stockedSet = hasBundleTerms && product && /\bBUNDLE\b/i.test(product.model_description) &&
      !/\b(?:BUY|GET|TAKE|FREE)\b|\b(?:BUY|GET|TAKE)\s*\d|\bB\dT\d\b/i.test(sourceTerms) &&
      !/\b(?:BUY|GET|TAKE|FREE)\b|\b(?:BUY|GET|TAKE)\s*\d|\bB\dT\d\b/i.test(product.model_description) &&
      modelTokens(row.description).length > 1 &&
      bundleModelKey(modelTokens(row.description)) === bundleModelKey(modelTokens(product.model_description));
    if (hasBundleTerms && !bundle && !stockedSet && !stockedMultiBuy) reasons.push("Bundle or free-item terms need product mapping.");
    if (!bundle && !product) reasons.push("No unique matching inventory barcode or product model.");
    else if (!bundle && (product.srp == null || !Number.isFinite(Number(product.srp)) || Number(product.srp) <= 0)) {
      reasons.push("The matching product needs a positive standard SRP.");
    }
    const components = bundle || [{ id: "component-1", barcode: product ? normalizeBarcode(product.barcode) : code, quantity: 1, free: false }];
    return { row, code, reasons, components, ready: reasons.length === 0 };
  });
}
