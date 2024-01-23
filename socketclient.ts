class SocketClient {
  private url: string;
  private socket: WebSocket | null = null;
  private listeners: Map<string, (data: any) => void> = new Map();
  private isConnected: boolean = false;
  private reconnectInterval: number = 1000;
  private maxReconnectAttempts: number = 10;
  private reconnectAttempts: number = 0;
  private logCallback: ((message: string) => void) | undefined;
  const NORMAL_CLOSURE_CODE = 1000;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  setLogCallback(callback: (message: string) => void): void {
    this.logCallback = callback;
  }

  private connect(): void {
    try {
      this.socket = new WebSocket(this.url);
    } catch (error) {
      this.logError('Failed to create WebSocket:', error);
      this.tryReconnect();
      return;
    }

    this.socket.addEventListener('open', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.log('Connected to server');
    });

    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event);
    });

    this.socket.addEventListener('close', (event) => {
      this.isConnected = false;
      this.log('Connection closed:', event.reason);

      if (event.code !== NORMAL_CLOSURE_CODE) {
        // Reconnect only if not a deliberate close (normal closure)
        this.tryReconnect();
      }
    });

    this.socket.addEventListener('error', (error) => {
      this.logError('WebSocket error:', error);
    });
  }

  private tryReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.pow(2, this.reconnectAttempts) * this.reconnectInterval;
      this.log(`Attempting to reconnect (attempt ${this.reconnectAttempts + 1} of ${this.maxReconnectAttempts}) in ${delay} ms`);
      setTimeout(() => {
        this.connect();
      }, delay);
      this.reconnectAttempts++;
    } else {
      this.log('Exceeded maximum reconnect attempts. Please handle reconnection manually.');
    }
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const { event: eventName, data } = JSON.parse(event.data);

      if (this.listeners.has(eventName)) {
        const listener = this.listeners.get(eventName);
        listener(data);
      } else {
        this.log(`Received event: ${eventName}, data:`, data);
      }
    } catch (error) {
      this.logError('Error parsing message:', error);
    }
  }

  public close(): void {
    if (this.socket && this.isConnected) {
      // Close the WebSocket connection with a normal closure
      this.socket.close(CLOSE_NORMAL);
      this.isConnected = false;
      this.log('WebSocket connection closed deliberately.');
    }
  }

  public on(eventName: string, callback: (data: any) => void): void {
    this.listeners.set(eventName, callback);
  }

  public emit(eventName: string, eventData: any): void {
    if (this.isConnected) {
      const message = JSON.stringify({ event: eventName, data: eventData });
      this.socket?.send(message);
    } else {
      this.logWarn('WebSocket is not connected. Unable to emit event.');
    }
  }

  private log(message: string): void {
    if (this.logCallback) {
      this.logCallback(message);
    }
  }

  private logWarn(message: string): void {
    if (this.logCallback) {
      this.logCallback(`Warning: ${message}`);
    }
  }

  private logError(message: string, error: any): void {
    if (this.logCallback) {
      this.logCallback(`Error: ${message} ${error}`);
    }
  }
}
