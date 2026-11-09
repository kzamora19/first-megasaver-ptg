import type { Metadata } from "next";
import ProductSearch, { type Product } from "../products/product-search";

export const metadata: Metadata = { title: "Sample Demo · Branchline PTG" };

const sampleProducts = [
  { model: "DEMO-AC10", category: "Aircon", description: "1.0 HP window air conditioner", price: 10990 },
  { model: "DEMO-AC15", category: "Aircon", description: "1.5 HP inverter air conditioner", price: 18990 },
  { model: "DEMO-REF7", category: "Refrigerator", description: "7 cu. ft. two-door refrigerator", price: 12990 },
  { model: "DEMO-TV43", category: "Television", description: "43-inch smart television", price: 11990 },
  { model: "DEMO-WM8", category: "Washer", description: "8 kg top-load washing machine", price: 9990 },
  { model: "DEMO-RC18", category: "Small Appliance", description: "1.8 L rice cooker", price: 1490 },
  { model: "DEMO-FAN16", category: "Small Appliance", description: "16-inch stand fan", price: 1990 },
].map(({ model, category, description, price }, index): Product => ({
  id: model,
  memo_id: "DEMO-MEMO",
  brand: "Sample Home",
  category,
  barcode: `DEMO-${String(index + 1).padStart(4, "0")}`,
  model,
  description,
  sub_category: category,
  srp: price + 500,
  cash_payment: price,
  tag_this: price,
  months_6: price,
  months_9: 0,
  months_12: price + 1000,
  months_18: 0,
  months_24: 0,
  remarks: "Demo only",
  eligible_for_price_tag: true,
  price_memos: { memo_id: "DEMO-MEMO", period: "Sample period", memo_type: "DEMO" },
}));

export default function DemoPage() {
  return <ProductSearch branchCode="DEMO" branchName="Demo Branch" demoProducts={sampleProducts} />;
}
