export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
  responseSchema: {
    type: string;
    properties: Record<string, any>;
  };
  examples: Array<{
    name: string;
    input: Record<string, any>;
    output: Record<string, any>;
  }>;
} 