class SocketClient {
  private url: string;
  private socket: WebSocket | null = null;
  private listeners: Map<string, (data: any) => void> = new Map();
  private isConnected: boolean = false;
  private reconnectInterval: number = 1000;
  private maxReconnectAttempts: number = 10;
  private reconnectAttempts: number = 0;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect(): void {
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener('open', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('Connected to server');
    });

    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event);
    });

    this.socket.addEventListener('close', (event) => {
      this.isConnected = false;
      console.log('Connection closed:', event.reason);

      if (event.code !== 1000) {
        // Reconnect only if not a deliberate close (code 1000)
        this.tryReconnect();
      }
    });

    this.socket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
    });
  }

  private tryReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      console.log(`Attempting to reconnect (attempt ${this.reconnectAttempts + 1} of ${this.maxReconnectAttempts})`);
      setTimeout(() => {
        this.connect();
      }, this.reconnectInterval);
      this.reconnectAttempts++;
    } else {
      console.log('Exceeded maximum reconnect attempts. Please handle reconnection manually.');
    }
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const { event: eventName, data } = JSON.parse(event.data);

      if (this.listeners.has(eventName)) {
        const listener = this.listeners.get(eventName);
        listener(data);
      } else {
        console.log(`Received event: ${eventName}, data:`, data);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
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
      console.warn('WebSocket is not connected. Unable to emit event.');
    }
  }
}
