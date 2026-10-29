import data from "./universities.json";

export interface Institution {
  id: string;
  name: string;
  country: string;
  type: "university" | "school";
  /** Official email domains. A student address matches when its domain equals one of these or is a sub-domain of it. */
  domains: string[];
}

/** Built-in institutions, alphabetical. Admins can add more in the Firestore `universities` collection. */
export const INSTITUTIONS: Institution[] = data as Institution[];

/** Does `email` belong to one of the institution's official domains (exact or sub-domain, e.g. student.nust.edu.pk)? */
export function emailMatchesInstitution(email: string, inst: Pick<Institution, "domains">): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return false;
  return inst.domains.some((d) => domain === d || domain.endsWith("." + d));
}
