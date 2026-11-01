import { Search } from "lucide-react";
import Form from "next/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchBox({ compact = false, defaultValue }: { compact?: boolean; defaultValue?: string }) {
  return (
    <Form action="/search" className="relative w-full">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        name="q"
        defaultValue={defaultValue}
        placeholder={compact ? "Product, maker, CAS or name…" : "Search products, makers, chemicals or CAS numbers…"}
        aria-label="Search products and chemicals"
        className={cn("pl-9", compact ? "h-8" : "h-12 text-base")}
      />
    </Form>
  );
}
