declare module "epubjs" {
  export interface NavItem {
    id: string;
    href: string;
    label: string;
    subitems?: NavItem[];
  }

  export interface Navigation {
    toc: NavItem[];
  }

  export interface Location {
    start: {
      cfi: string;
      displayed: {
        page: number;
        total: number;
      };
    };
    end: {
      cfi: string;
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ThemeStyles = Record<string, Record<string, string> | string | any>;

  export interface Rendition {
    display(target?: string): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, callback: (...args: any[]) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    off(event: string, callback: (...args: any[]) => void): void;
    themes: {
      default(styles: ThemeStyles): void;
      fontSize(size: string): void;
    };
    currentLocation(): Location | null;
    destroy(): void;
  }

  export interface Book {
    loaded: {
      navigation: Promise<Navigation>;
      metadata: Promise<{
        title: string;
        creator: string;
        description: string;
        pubdate: string;
        publisher: string;
        identifier: string;
        language: string;
        rights: string;
        modified_date: string;
      }>;
    };
    renderTo(
      element: HTMLElement | string,
      options?: {
        width?: string | number;
        height?: string | number;
        spread?: "none" | "auto";
        flow?: "paginated" | "scrolled";
      }
    ): Rendition;
    destroy(): void;
  }

  export default function ePub(url: string | ArrayBuffer): Book;
}
