/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";
import { Message, AppSettings } from "../types";
import { CapacitorHttp } from '@capacitor/core';

// Helper to sanitize API endpoint
function sanitizeEndpoint(endpoint: string): string {
  let sanitized = endpoint.trim();
  if (!sanitized.startsWith('http')) {
    sanitized = `http://${sanitized}`;
  }
  // Ensure it ends with /v1 for LM Studio compatibility
  if (!sanitized.endsWith('/v1') && !sanitized.endsWith('/v1/')) {
    sanitized = `${sanitized.replace(/\/$/, '')}/v1`;
  }
  return sanitized;
}

const DEFAULT_SEARXNG_INSTANCES = [
  'https://search.bus-hit.me',
  'https://searx.be',
  'https://search.sapti.me'
];

export async function searchWeb(query: string, searxngUrl?: string): Promise<string> {
  const instances = searxngUrl ? [searxngUrl] : DEFAULT_SEARXNG_INSTANCES;
  
  for (const instance of instances) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`;
      console.log('Searching SearXNG:', url);
      
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      } catch (fetchErr) {
        console.warn(`SearXNG instance ${instance} failed`, fetchErr);
        continue;
      }
      
      if (!response.ok) {
        console.warn(`SearXNG returned status ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      const results = data.results || [];
      
      if (results.length === 0) {
        continue;
      }
      
      let searchResults = `## 联网搜索结果\n\n`;
      for (let i = 0; i < Math.min(results.length, 5); i++) {
        const r = results[i];
        searchResults += `${i + 1}. **${r.title || '无标题'}**\n`;
        if (r.content) {
          searchResults += `   ${r.content.substring(0, 300)}\n\n`;
        }
        if (r.url) {
          searchResults += `   🔗 [链接](${r.url})\n\n`;
        }
      }
      
      console.log('SearXNG search results:', searchResults);
      return searchResults;
    } catch (err) {
      console.warn(`Search failed on ${instance}:`, err);
      continue;
    }
  }
  
  return '';
}

export async function sendMessageToGemini(
  messages: Message[],
  settings: AppSettings,
  onChunk?: (chunk: string) => void
) {
  try {
    if (settings.apiEndpoint) {
      const sanitizedEndpoint = sanitizeEndpoint(settings.apiEndpoint);
      const url = `${sanitizedEndpoint}/chat/completions`;
      console.log("Attempting to connect to API endpoint:", url);
      
      const systemMessage = settings.systemInstruction 
        ? [{ role: 'system', content: settings.systemInstruction }] 
        : [{ role: 'system', content: `你是 ${settings.aiName}，一个乐于助人的 AI 助手。请用中文回答。保持回答简洁并适合移动端阅读。使用 markdown 格式。` }];

      const mapMessageToCustomContent = (msg: Message) => {
        const parts: any[] = [];
        let text = msg.content;
        
        // Ensure some text exists for all messages to satisfy strict proxies
        if (!text) {
          if (msg.type === 'image') text = '[图片]';
          else if (msg.type === 'voice') text = '[语音]';
          else text = ' '; // At least a space
        }

        if (msg.quote) {
          text = `引用消息 [${msg.quote.userName}]: "${msg.quote.content}"\n\n回复上面的消息: ${text}`;
        }
        
        if (text) {
          parts.push({ type: 'text', text });
        }

        if (msg.type === 'image' && msg.mediaUrl) {
          parts.push({
            type: 'image_url',
            image_url: {
              url: msg.mediaUrl
            }
          });
        }
        
        // Voice is tricky for OpenAI format, usually handled as audio uploads or separate fields.
        // For now, we'll focus on image recognition as requested.
        
        return parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
      };

      const history = messages.slice(0, -1).map(msg => {
        const customContent = mapMessageToCustomContent(msg);
        return {
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: customContent || ' ',
          // Some proxies require a string 'content' or 'message_content'
          message_content: msg.content || ' '
        };
      });

      const lastMessage = messages[messages.length - 1];
      let userContent = mapMessageToCustomContent(lastMessage);

      // Web search integration
      if (settings.enableWebSearch && typeof userContent === 'string' && userContent.trim()) {
        try {
          onChunk?.('[正在联网搜索...]');
          const searchResults = await searchWeb(userContent, settings.searxngUrl);
          if (searchResults) {
            userContent += `\n\n---\n## 参考搜索结果\n${searchResults}\n请基于以上搜索结果回答问题。`;
            console.log('Appended web search results to prompt');
          } else {
            onChunk?.('[搜索未返回结果，直接回答...]');
          }
        } catch (err) {
          console.error('Web search failed:', err);
        }
      }

      // Use CapacitorHttp for better compatibility and to bypass CORS on mobile
      // Try streaming first, fall back to non-streaming if not supported
      const streamEnabled = true;
      
      const options: any = {
        url: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey || "lm-studio"}`
        },
        data: {
          model: settings.modelName || "local-model",
          messages: [
            ...systemMessage,
            ...history,
            { 
              role: 'user', 
              content: userContent || ' ',
              ...(typeof userContent !== 'string' ? { text: lastMessage.content || ' ' } : {})
            }
          ],
          stream: streamEnabled,
        },
        connectTimeout: 30000,
        readTimeout: 120000
      };

      let fullText = "";
      
      try {
        const response = await CapacitorHttp.request(options);

        if (response.status < 200 || response.status >= 300) {
          console.error("API Response Error:", response);
          
          // If streaming failed, retry without streaming
          options.data.stream = false;
          const fallbackResponse = await CapacitorHttp.request(options);
          
          if (fallbackResponse.status < 200 || fallbackResponse.status >= 300) {
            throw new Error(`API 请求失败: ${fallbackResponse.status} ${fallbackResponse.data?.error?.message || ''}`);
          }
          
          fullText = fallbackResponse.data.choices[0]?.message?.content || "";
          if (fullText) {
            onChunk?.(fullText);
          }
          return fullText;
        }

        // Handle streaming response - some proxies return SSE format
        const choiceData = response.data.choices?.[0];
        
        if (choiceData?.message?.content) {
          // Non-streaming response even though we requested stream
          fullText = choiceData.message.content;
          onChunk?.(fullText);
        } else if (choiceData?.delta?.content) {
          // Single chunk streaming response
          fullText = choiceData.delta.content;
          onChunk?.(fullText);
        } else if (typeof response.data === 'string') {
          // Raw SSE string - parse it
          const lines = response.data.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const jsonStr = line.substring(6);
                const parsed = JSON.parse(jsonStr);
                const deltaContent = parsed.choices?.[0]?.delta?.content;
                if (deltaContent) {
                  fullText += deltaContent;
                  onChunk?.(deltaContent);
                }
              } catch {}
            }
          }
        }

        // Check for reasoning/thinking content in some model responses
        const reasoning = choiceData?.message?.reasoning_content || 
                         choiceData?.message?.reasoning || 
                         choiceData?.delta?.reasoning_content ||
                         choiceData?.delta?.reasoning;
        
        if (reasoning) {
          console.log('Reasoning content detected:', reasoning);
        }

      } catch (error) {
        // If CapacitorHttp fails, try native fetch as fallback
        fullText = await fetchWithFallback(url, options, onChunk);
      }
      
      return fullText;
    }

    // Use GoogleGenAI client
    const ai = new GoogleGenAI({ 
      apiKey: settings.apiKey || process.env.GEMINI_API_KEY || ""
    });

    const modelName = settings.modelName || "gemini-3-flash-preview";
    const systemInstruction = settings.systemInstruction || `你是 ${settings.aiName}，一个乐于助人的 AI 助手。请用中文回答。保持回答简洁并适合移动端阅读。使用 markdown 格式。`;

    // Helper to map message to Gemini parts
    const mapMessageToParts = (msg: Message) => {
      console.log("Mapping message to parts, type:", msg.type, "hasMediaUrl:", !!msg.mediaUrl);
      const msgParts: any[] = [];
      let finalContent = msg.content;

      // Ensure some text exists for all messages
      if (!finalContent) {
        if (msg.type === 'image') finalContent = '[图片]';
        else if (msg.type === 'voice') finalContent = '[语音]';
        else finalContent = ' ';
      }

      // Handle quotes
      if (msg.quote) {
        finalContent = `引用消息 [${msg.quote.userName}]: "${msg.quote.content}"\n\n回复上面的消息: ${finalContent}`;
      }

      msgParts.push({ text: finalContent || ' ' });

      if ((msg.type === 'image' || msg.type === 'voice') && msg.mediaUrl) {
        try {
          // Robustly handle data URI
          const commaIndex = msg.mediaUrl.indexOf(',');
          if (commaIndex === -1) throw new Error("Invalid media URL format: no comma");
          
          const base64Data = msg.mediaUrl.substring(commaIndex + 1);
          const metaPart = msg.mediaUrl.substring(0, commaIndex);
          
          const mimeTypeMatch = metaPart.match(/data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-.+]+)/);
          const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : (msg.type === 'voice' ? 'audio/wav' : 'image/jpeg');

          msgParts.push({
            inlineData: {
              data: base64Data,
              mimeType: mimeType
            }
          });
        } catch (e) {
          console.error("Error parsing media URL:", e);
        }
      }
      return msgParts;
    };

    const history = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: mapMessageToParts(msg),
    }));

    const lastMessage = messages[messages.length - 1];
    const parts = mapMessageToParts(lastMessage);

    const responseStream = await ai.models.generateContentStream({
      model: modelName,
      contents: [
        ...history,
        { role: 'user', parts }
      ],
      config: {
        systemInstruction: systemInstruction,
        tools: [{ googleSearch: {} }] as any,
      }
    });

    let fullText = "";
    for await (const chunk of responseStream) {
      const text = chunk.text;
      if (text) {
        fullText += text;
        onChunk?.(text);
      }
      
      // Check for reasoning/thinking content in GoogleGenAI responses
      const reasoning = (chunk as any).reasoning || (chunk as any).thinking;
      if (reasoning && onChunk) {
        // Send reasoning separately with a marker
        onChunk?.(`[THINKING]${reasoning}`);
      }
    }

    return fullText;
  } catch (error) {
    console.error("API Error:", error);
    if (error instanceof Error) {
      if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('Failed to fetch')) {
        throw new Error("网络连接错误，请检查您的网络设置、API 端点配置，或确保安卓应用已开启明文 HTTP 请求权限。");
      }
      throw new Error(`API 错误: ${error.message}`);
    }
    throw new Error("发生未知错误，请稍后再试。");
  }
}

// Fallback fetch function for streaming support
async function fetchWithFallback(
  url: string, 
  options: any, 
  onChunk?: (chunk: string) => void
): Promise<string> {
  let fullText = "";
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(options.data),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Try streaming with ReadableStream
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('text/event-stream') || options.data?.stream) {
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const jsonStr = line.substring(6);
                const parsed = JSON.parse(jsonStr);
                const deltaContent = parsed.choices?.[0]?.delta?.content;
                if (deltaContent) {
                  fullText += deltaContent;
                  onChunk?.(deltaContent);
                }
              } catch {}
            }
          }
        }
      }
    } else {
      // Non-streaming response
      const data = await response.json();
      fullText = data.choices?.[0]?.message?.content || "";
      if (fullText) {
        onChunk?.(fullText);
      }
    }
  } catch (e) {
    console.error('Fetch fallback error:', e);
    throw new Error("网络连接错误，请检查您的网络设置。");
  }
  
  return fullText;
}
