import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { INSTITUTIONS, type Institution } from "@/data/universities";
import { SearchableSelect } from "@/components/searchable-select";

/** Built-in list + institutions admins have added in Firestore (`universities`), merged and sorted once per page load. */
let extraCache: Institution[] | null = null;
async function loadExtra(): Promise<Institution[]> {
  if (extraCache) return extraCache;
  let rows: Institution[] = [];
  try {
    const snap = await getDocs(query(collection(db, "universities"), limit(500)));
    rows = snap.docs.map((d) => ({ ...(d.data() as Omit<Institution, "id">), id: d.id }));
  } catch {
    rows = [];
  }
  extraCache = rows;
  return rows;
}

export function useInstitutions(): Institution[] {
  const [extra, setExtra] = useState<Institution[]>([]);
  useEffect(() => {
    void loadExtra().then(setExtra);
  }, []);
  return useMemo(() => {
    const byId = new Map<string, Institution>();
    [...INSTITUTIONS, ...extra].forEach((i) => byId.set(i.id, i));
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [extra]);
}

interface Props {
  id?: string;
  /** Institution name (stored in the profile as `institution`). */
  value: string;
  onChange: (name: string, institution?: Institution) => void;
  invalid?: boolean;
}

/** Searchable, alphabetical school/university picker. Unlisted places can be typed and used as a custom entry. */
export function InstitutionSelect({ id, value, onChange, invalid }: Props) {
  const institutions = useInstitutions();
  const options = useMemo(
    () =>
      institutions.map((i) => ({
        value: i.name,
        label: i.name,
        hint: i.type === "school" ? `${i.country} · School` : i.country,
      })),
    [institutions],
  );
  return (
    <SearchableSelect
      id={id}
      value={value}
      invalid={invalid}
      options={options}
      allowCustom
      placeholder="Search your school or university"
      searchPlaceholder="Type a name, e.g. UMT, LUMS, Aitchison…"
      emptyText="Not listed? Keep typing, then choose “Use …” to add it."
      onChange={(v) => onChange(v, institutions.find((i) => i.name === v))}
      aria-label="School or university"
    />
  );
}
