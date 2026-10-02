// Local stand-in for @types/react, used only by `npm run typecheck:local` in environments where the npm registry
// is not reachable. With `npm install`, the real @types/react and @types/react-dom are used instead (tsconfig.json).
declare namespace React {
  type ReactNode = any;
  type Key = string | number;
  type FC<P = {}> = (props: P) => any;
  type ComponentType<P = {}> = (props: P) => any;
  type Dispatch<A> = (value: A) => void;
  type SetStateAction<S> = S | ((prev: S) => S);
  interface RefObject<T> { current: T }
  interface CSSProperties { [k: string]: string | number | undefined }
  interface SyntheticEvent<T = Element> { target: EventTarget & T; currentTarget: EventTarget & T; preventDefault(): void; stopPropagation(): void; defaultPrevented: boolean; nativeEvent: Event; type: string }
  interface MouseEvent<T = Element> extends SyntheticEvent<T> { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number; clientX: number; clientY: number }
  interface KeyboardEvent<T = Element> extends SyntheticEvent<T> { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
  interface ChangeEvent<T = Element> extends SyntheticEvent<T> {}
  interface FormEvent<T = Element> extends SyntheticEvent<T> {}
  interface FocusEvent<T = Element> extends SyntheticEvent<T> { relatedTarget: EventTarget | null }
  interface DragEvent<T = Element> extends MouseEvent<T> { dataTransfer: DataTransfer }
  interface ClipboardEvent<T = Element> extends SyntheticEvent<T> { clipboardData: DataTransfer }
  type H = (e: any) => void;
  interface DOMAttributes<T> {
    children?: ReactNode;
    onClick?: H; onDoubleClick?: H; onChange?: H; onInput?: H; onSubmit?: H; onKeyDown?: H; onKeyUp?: H; onFocus?: H; onBlur?: H;
    onMouseDown?: H; onMouseUp?: H; onMouseEnter?: H; onMouseLeave?: H; onMouseMove?: H; onPointerDown?: H; onPointerUp?: H; onPointerMove?: H;
    onDragStart?: H; onDragEnd?: H; onDragOver?: H; onDragEnter?: H; onDragLeave?: H; onDrop?: H; onPaste?: H; onScroll?: H; onLoad?: H; onError?: H;
    onTouchStart?: H; onTouchEnd?: H; onAnimationEnd?: H; onTransitionEnd?: H; onToggle?: H; onWheel?: H; onContextMenu?: H;
  }
  interface HTMLAttributes<T> extends DOMAttributes<T> { [attr: string]: any; className?: string; style?: CSSProperties; id?: string; ref?: any }
  interface SVGAttributes<T> extends HTMLAttributes<T> {}
  interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> { type?: 'button' | 'submit' | 'reset'; disabled?: boolean }
  interface AnchorHTMLAttributes<T> extends HTMLAttributes<T> { href?: string; target?: string; rel?: string }
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> { value?: any; type?: string }
  interface SelectHTMLAttributes<T> extends HTMLAttributes<T> { value?: any }
  interface TextareaHTMLAttributes<T> extends HTMLAttributes<T> { value?: any }
  function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  function useReducer<S, A>(reducer: (s: S, a: A) => S, initial: S): [S, Dispatch<A>];
  function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  function useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly unknown[]): T;
  function useRef<T>(initial: T): RefObject<T>;
  function useRef<T>(initial: T | null): RefObject<T | null>;
  function useRef<T = undefined>(): RefObject<T | undefined>;
  function useId(): string;
  function useSyncExternalStore<T>(subscribe: (l: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T): T;
  function lazy<T extends (props: any) => any>(factory: () => Promise<{ default: T }>): T;
  const Suspense: (props: { children?: ReactNode; fallback?: ReactNode }) => any;
  function forwardRef<T, P = {}>(render: (props: P, ref: any) => any): (props: P & { ref?: any }) => any;
  function useImperativeHandle<T>(ref: any, init: () => T, deps?: readonly unknown[]): void;
  function startTransition(fn: () => void): void;
  function memo<P>(c: (props: P) => any): (props: P) => any;
  const Fragment: (props: { children?: ReactNode; key?: Key }) => any;
  const StrictMode: (props: { children?: ReactNode }) => any;
}
declare module 'react' { export = React; }
declare module 'react/jsx-runtime' {
  export namespace JSX {
    type Element = any;
    interface ElementChildrenAttribute { children: {} }
    interface IntrinsicAttributes { key?: string | number | null }
    interface IntrinsicElements { [tag: string]: React.HTMLAttributes<any> }
  }
  export const jsx: any; export const jsxs: any; export const Fragment: any;
}
declare module 'react-dom/client' { export function createRoot(el: Element): { render(node: any): void; unmount(): void }; }
declare module 'react-dom' { export function createPortal(node: any, el: Element): any; export function flushSync(fn: () => void): void; }
declare module '*.css';
