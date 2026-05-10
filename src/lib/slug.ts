export const slugify = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const uniqueSlug = async (
  base: string,
  exists: (slug: string) => Promise<boolean>
): Promise<string> => {
  let slug = base;
  let i = 1;
  while (await exists(slug)) {
    slug = `${base}-${i}`;
    i++;
  }
  return slug;
};
