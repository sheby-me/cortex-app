import { useMemo } from "react";
import { COUNTRIES } from "@/data/countries";
import { SearchableSelect } from "@/components/searchable-select";

export function CountrySelect({ id, value, onChange, invalid }: { id?: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const options = useMemo(() => COUNTRIES.map((c) => ({ value: c, label: c })), []);
  return (
    <SearchableSelect
      id={id}
      value={value}
      onChange={(v) => onChange(v)}
      options={options}
      invalid={invalid}
      placeholder="Select your country"
      searchPlaceholder="Search countries…"
      aria-label="Country"
    />
  );
}
