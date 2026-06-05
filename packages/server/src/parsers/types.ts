export interface ParseResult {
  markdown: string;
  metadata: {
    title?: string;
    author?: string;
    year?: number;
    language?: string;
    description?: string;
  };
  cover?: { data: Buffer; ext: string };
}

export interface BookParser {
  readonly name: string;
  readonly extensions: string[];
  parse(filePath: string): Promise<ParseResult>;
}
