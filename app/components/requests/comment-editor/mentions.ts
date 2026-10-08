export type MentionPerson = { id: string; name: string };
export function mentionQuery(beforeCursor: string) {
  const match = /(?:^|\s)@([\p{L}\p{M}\p{N} '\-]{0,80})$/u.exec(beforeCursor);
  return match ? { query: match[1], length: match[1].length + 1 } : null;
}
export const foldName = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
export function filterMentionPeople(people: MentionPerson[], query: string) {
  const terms = foldName(query).split(/\s+/).filter(Boolean);
  return people.filter(person => terms.every(term => foldName(person.name).includes(term)));
}
