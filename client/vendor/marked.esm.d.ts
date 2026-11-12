// Types minimaux de marked (copie vendue, pas de @types) : seul ce que le client utilise.
export const marked: {
  parse(md: string): string | Promise<string>;
  parseInline(md: string): string | Promise<string>;
  setOptions(o: object): void;
};
