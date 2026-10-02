/**
 * The rules a cart is type-checked by, in the Play editor and in `ojplay
 * typecheck` alike: one module, so a cart clean in one is clean in the other.
 *
 * They were two. The editor checks loosely, with no DOM, and the scaffold's
 * tsconfig checked strictly with the DOM, so code that was clean in the editor
 * failed locally (the Ghost Hunt dry run, 2 Oct 2026) and agents added types
 * to quiet a checker nobody else ran. The editor's are the rules: a cart is
 * written there first, and a new author meets them before any tsconfig.
 */

/**
 * What the compiler is told, in tsconfig's spelling. No DOM: a cart runs in
 * the container and, ejected, in a OneJS app, and neither gives it a document
 * (the new-user test, E1). Not strict: the editor never was, and a learner's
 * `useRef(null)` should not need a type to be correct.
 */
export const CART_COMPILER_OPTIONS = Object.freeze({
    target: "ES2020",
    lib: Object.freeze(["ES2020"]),
    strict: false,
})

/**
 * The globals a cart has instead: what OneJS's runtime installs and the
 * sandbox does not shadow (onejs-play src/sandbox.ts).
 *
 * console, the timers, frames, performance and WebSocket as OneJS's template
 * types/global.d.ts declares them (OneJS 3.9.3); fetch, Response, Headers,
 * URL, URLSearchParams, AbortController, atob, btoa, localStorage and
 * sessionStorage as its QuickJSBootstrap installs them, which global.d.ts does
 * not yet type (Singtaa/OneJS#137). Only the members those implementations
 * have: Response has text, json and clone, and no arrayBuffer. The filesystem
 * functions and the C# plumbing are left out because the sandbox hides them.
 */
export const CART_HOST_TYPES = [
    "declare const console: {",
    "  log(...args: unknown[]): void; info(...args: unknown[]): void; debug(...args: unknown[]): void;",
    "  warn(...args: unknown[]): void; error(...args: unknown[]): void;",
    "};",
    "declare function setTimeout(callback: () => void, ms?: number): number;",
    "declare function clearTimeout(id: number): void;",
    "declare function setInterval(callback: () => void, ms?: number): number;",
    "declare function clearInterval(id: number): void;",
    "declare function requestAnimationFrame(callback: (timestamp: number) => void): number;",
    "declare function cancelAnimationFrame(id: number): void;",
    "declare function queueMicrotask(callback: () => void): void;",
    "declare const performance: { now(): number };",
    "declare class Headers {",
    "  constructor(init?: Record<string, string> | [string, string][] | Headers);",
    "  get(name: string): string | null; has(name: string): boolean;",
    "  set(name: string, value: string): void; append(name: string, value: string): void; delete(name: string): void;",
    "  forEach(callback: (value: string, name: string) => void): void;",
    "  keys(): IterableIterator<string>; values(): IterableIterator<string>; entries(): IterableIterator<[string, string]>;",
    "}",
    "declare class Response {",
    "  readonly ok: boolean; readonly status: number; readonly statusText: string; readonly url: string;",
    "  readonly headers: Headers; readonly bodyUsed: boolean;",
    "  text(): Promise<string>; json(): Promise<any>; clone(): Response;",
    "}",
    "interface AbortSignal {",
    "  readonly aborted: boolean; readonly reason: unknown;",
    "  addEventListener(type: \"abort\", listener: () => void): void;",
    "  removeEventListener(type: \"abort\", listener: () => void): void;",
    "}",
    "declare class AbortController { readonly signal: AbortSignal; abort(reason?: unknown): void }",
    "interface RequestInit {",
    "  method?: string; headers?: Record<string, string> | [string, string][] | Headers;",
    "  body?: string; signal?: AbortSignal;",
    "}",
    "declare function fetch(input: string | URL, init?: RequestInit): Promise<Response>;",
    "declare class URLSearchParams {",
    "  constructor(init?: string | Record<string, string> | [string, string][]);",
    "  readonly size: number;",
    "  get(name: string): string | null; getAll(name: string): string[]; has(name: string): boolean;",
    "  set(name: string, value: string): void; append(name: string, value: string): void; delete(name: string): void;",
    "  sort(): void; toString(): string;",
    "  forEach(callback: (value: string, name: string) => void): void;",
    "  keys(): IterableIterator<string>; values(): IterableIterator<string>; entries(): IterableIterator<[string, string]>;",
    "}",
    "declare class URL {",
    "  constructor(url: string, base?: string | URL);",
    "  readonly origin: string; readonly searchParams: URLSearchParams;",
    "  href: string; protocol: string; username: string; password: string; host: string; hostname: string;",
    "  port: string; pathname: string; search: string; hash: string;",
    "  toString(): string; toJSON(): string;",
    "}",
    "declare function atob(data: string): string;",
    "declare function btoa(data: string): string;",
    "interface Storage {",
    "  readonly length: number;",
    "  getItem(key: string): string | null; setItem(key: string, value: string): void;",
    "  removeItem(key: string): void; clear(): void; key(index: number): string | null;",
    "}",
    "declare const localStorage: Storage;",
    "declare const sessionStorage: Storage;",
    "interface WebSocketEvent { readonly type: string; readonly target: WebSocket; readonly currentTarget: WebSocket }",
    "interface WebSocketMessageEvent extends WebSocketEvent { readonly data: string | ArrayBuffer }",
    "interface WebSocketCloseEvent extends WebSocketEvent { readonly code: number; readonly reason: string; readonly wasClean: boolean }",
    "declare class WebSocket {",
    "  static readonly CONNECTING: 0; static readonly OPEN: 1; static readonly CLOSING: 2; static readonly CLOSED: 3;",
    "  readonly CONNECTING: 0; readonly OPEN: 1; readonly CLOSING: 2; readonly CLOSED: 3;",
    "  constructor(url: string, protocols?: string | string[]);",
    "  readonly url: string; readonly readyState: number; readonly protocol: string;",
    "  readonly extensions: string; readonly bufferedAmount: number; binaryType: \"arraybuffer\";",
    "  onopen: ((event: WebSocketEvent) => void) | null;",
    "  onmessage: ((event: WebSocketMessageEvent) => void) | null;",
    "  onerror: ((event: WebSocketEvent) => void) | null;",
    "  onclose: ((event: WebSocketCloseEvent) => void) | null;",
    "  send(data: string | ArrayBuffer | ArrayBufferView): void;",
    "  close(code?: number, reason?: string): void;",
    "  addEventListener(type: string, listener: (event: any) => void): void;",
    "  removeEventListener(type: string, listener: (event: any) => void): void;",
    "}",
].join("\n")
