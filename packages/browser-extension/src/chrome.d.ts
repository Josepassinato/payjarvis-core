/**
 * Minimal Chrome Extension API type declarations.
 * In production, install @types/chrome for full types.
 */

declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      get(keys: string | string[], callback: (result: Record<string, unknown>) => void): void;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const sync: StorageArea;
    const local: StorageArea;
  }

  namespace runtime {
    function sendMessage(
      message: unknown,
      callback?: (response: any) => void
    ): void;

    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: unknown,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
  }

  namespace alarms {
    interface Alarm {
      name: string;
    }

    function create(name: string, info: { periodInMinutes: number }): void;
    function clear(name: string): Promise<boolean>;

    const onAlarm: {
      addListener(callback: (alarm: Alarm) => void): void;
    };
  }

  namespace action {
    function setBadgeText(details: { text: string }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string }): Promise<void>;

    const onClicked: {
      addListener(callback: (tab: unknown) => void): void;
    };
  }
}
