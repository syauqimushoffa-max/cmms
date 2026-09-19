declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(filename: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    function(name: string, callback: (...args: any[]) => any): void;
    close(): void;
  }

  export class StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown | undefined;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }
}
