// src/lib/logger.ts

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: any;
}

class AgentLogger {
  private logs: LogEntry[] = [];
  
  private log(level: LogLevel, component: string, message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      data
    };
    
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift(); // keep last 500
    
    const prefix = `[${level.toUpperCase()}] [${component}]`;
    if (level === 'error') console.error(prefix, message, data || '');
    else if (level === 'warn') console.warn(prefix, message, data || '');
    else if (level === 'debug') console.debug(prefix, message, data || '');
    else console.log(prefix, message, data || '');

    // Dispatch custom event for UI rendering if in a DOM context
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('agent-log', { detail: entry }));
    }


  }

  info(component: string, message: string, data?: any) { this.log('info', component, message, data); }
  warn(component: string, message: string, data?: any) { this.log('warn', component, message, data); }
  error(component: string, message: string, data?: any) { this.log('error', component, message, data); }
  debug(component: string, message: string, data?: any) { this.log('debug', component, message, data); }
  
  exportLogs() {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const logger = new AgentLogger();
