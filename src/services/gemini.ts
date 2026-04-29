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
      const userContent = mapMessageToCustomContent(lastMessage);

      // Use CapacitorHttp for better compatibility and to bypass CORS on mobile
      const options = {
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
              // Some proxies expect a string content even for vision
              ...(typeof userContent !== 'string' ? { text: lastMessage.content || ' ' } : {})
            }
          ],
          stream: false,
        },
        connectTimeout: 30000,
        readTimeout: 60000
      };

      const response = await CapacitorHttp.request(options);

      if (response.status < 200 || response.status >= 300) {
        console.error("API Response Error:", response);
        throw new Error(`API 请求失败: ${response.status} ${response.data?.error?.message || ''}`);
      }

      const fullText = response.data.choices[0]?.message?.content || "";
      
      if (fullText) {
        onChunk?.(fullText);
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
