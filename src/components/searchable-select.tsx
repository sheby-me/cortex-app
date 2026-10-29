import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary text shown under the label (e.g. the country) and also searched. */
  hint?: string;
}

interface Props {
  id?: string;
  value: string;
  onChange: (value: string, option?: SelectOption) => void;
  options: SelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** When set, a typed term that matches nothing can be used as a custom value ("Use “…”"). */
  allowCustom?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Searchable (type-to-filter) dropdown built on the existing Popover + Command primitives. Options should already be
 * sorted; filtering is case-insensitive over label and hint. Handles a few hundred options without virtualisation.
 */
export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No matches found.",
  allowCustom = false,
  invalid,
  disabled,
  className,
  ...rest
}: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const selected = options.find((o) => o.value === value);
  const trimmed = term.trim();
  const exact = useMemo(() => options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase()), [options, trimmed]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTerm(""); }}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          aria-label={rest["aria-label"]}
          disabled={disabled}
          className={cn("mt-1.5 w-full justify-between rounded-md font-normal", !value && "text-muted-foreground", invalid && "border-destructive", className)}
        >
          <span className="truncate">{selected?.label ?? (value || placeholder)}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[260px] p-0" align="start">
        <Command
          filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0)}
        >
          <CommandInput placeholder={searchPlaceholder} value={term} onValueChange={setTerm} />
          <CommandList className="max-h-64">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {allowCustom && trimmed.length >= 2 && !exact && (
                <CommandItem
                  value={`__custom__ ${trimmed}`}
                  forceMount
                  onSelect={() => {
                    onChange(trimmed);
                    setOpen(false);
                  }}
                >
                  Use “{trimmed}”
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.hint ?? ""}`}
                  onSelect={() => {
                    onChange(o.value, o);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", o.value === value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="truncate text-xs text-muted-foreground">{o.hint}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
