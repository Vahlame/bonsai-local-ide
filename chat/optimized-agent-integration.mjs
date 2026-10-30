/**
 * Optimized Agent Integration for RTX 4060
 * 
 * End-to-end optimizations:
 * 1. Dynamic context sizing based on VRAM
 * 2. Speculative decoding integration
 * 3. Parallel tool execution
 * 4. Optimized verification pipeline
 * 5. Smart KV quantization selection
 * 6. Adaptive batch/ubatch sizing
 */

import { estimateTokens, takeHeadByTokens } from "./context.mjs";
import { CoderTask, CODER_CONFIG } from "./coder-harness.mjs";
import { nativeToolEffects, PC_TOOLS } from "./actions.mjs";
import { leerWeb, descargarWeb } from "./investigacion.mjs";

/**
 * Configuración optimizada para RTX 4060 8GB
 */
export const RTX4060_OPTIMIZED_CONFIG = {
  // VRAM budgets per profile (MiB)
  vramBudgets: {
    "8GB-VISION-ULTRA": { context: 36864, kv: "IQ4_XS", margin: 150, vision: true, specDecode: true },
    "8GB-VISION-HIGH": { context: 32768, kv: "IQ4_XS", margin: 200, vision: true },
    "8GB-VISION-BALANCED": { context: 28672, kv: "q4_0", margin: 250, vision: true },
    "8GB-VISION-SAFE": { context: 24576, kv: "q4_0", margin: 300, vision: true },
    "8GB-CODE-MAX": { context: 49152, kv: "IQ2_XS", margin: 100, vision: false, specDecode: true },
    "8GB-CODE-HIGH": { context: 40960, kv: "q4_0", margin: 150, vision: false },
    "8GB-CODE-BALANCED": { context: 32768, kv: "q8_0", margin: 200, vision: false },
    "8GB-CODE-FAST": { context: 16384, kv: "f16", margin: 100, vision: false, specDecode: true },
    "8GB-RESEARCH": { context: 65536, kv: "IQ1_S", margin: 50, vision: false },
    "8GB-VISION-QUALITY": { context: 32768, kv: "f16", margin: 100, vision: true }
  },

  // KV bytes per element
  kvBytes: {
    "f16": 2.0,
    "q8_0": 1.0,
    "q4_0": 0.5,
    "IQ4_XS": 0.5625,
    "IQ2_XS": 0.28125,
    "IQ1_S": 0.15625
  },

  // Optimal batch/ubatch per context size
  batchSizes: {
    small: { context: 16384, batch: 1024, ubatch: 512 },
    medium: { context: 32768, batch: 512, ubatch: 256 },
    large: { context: 49152, batch: 256, ubatch: 128 },
    xlarge: { context: 65536, batch: 128, ubatch: 64 }
  }
};

/**
 * Calcula VRAM requerida para una configuración
 */
export function calculateVRAM(config, modelProfile) {
  const { context, kv, vision } = config;
  const kvBytes = RTX4060_OPTIMIZED_CONFIG.kvBytes[kv] || 2.0;
  
  // Weights (from model profile)
  const weightsMiB = modelProfile.weightsMiB || 4864;
  
  // KV cache
  const attentionLayers = modelProfile.attentionLayers || 8;
  const kvHeads = modelProfile.kvHeads || 4;
  const headDim = modelProfile.headDim || 256;
  const kvCacheBytes = context * attentionLayers * kvHeads * headDim * 2 * kvBytes;
  const kvCacheMiB = Math.ceil(kvCacheBytes / (1024 * 1024));
  
  // Model reserves
  const modelReserveMiB = modelProfile.reserveMiB || 620;
  
  // Vision projector
  const visionMiB = vision ? (modelProfile.visionReserveMiB || 900) : 0;
  
  // Safety margin
  const marginMiB = config.margin || 200;
  
  return weightsMiB + kvCacheMiB + modelReserveMiB + visionMiB + marginMiB;
}

/**
 * Selecciona el mejor perfil basado en VRAM libre
 */
export function selectOptimalProfile(freeVRAM, preferVision = true, preferContext = false) {
  const profiles = RTX4060_OPTIMIZED_CONFIG.vramBudgets;
  let best = null;
  let bestScore = -1;
  
  for (const [name, config] of Object.entries(profiles)) {
    if (config.vision !== preferVision) continue;
    
    // Estimate VRAM needed (simplified)
    const kvBytes = RTX4060_OPTIMIZED_CONFIG.kvBytes[config.kv] || 2.0;
    const attentionLayers = 8; // Ornith 9B
    const kvHeads = 4;
    const headDim = 256;
    const kvCacheMiB = Math.ceil(config.context * attentionLayers * kvHeads * headDim * 2 * kvBytes / (1024 * 1024));
    const estimated = 4864 + kvCacheMiB + 620 + (config.vision ? 900 : 0) + (config.margin || 200);
    
    if (estimated <= freeVRAM) {
      const score = preferContext ? config.context : (config.specDecode ? 1000 : 0) + config.context;
      if (score > bestScore) {
        bestScore = score;
        best = { name, config, estimated };
      }
    }
  }
  
  return best;
}

/**
 * CoderTask optimizado para RTX 4060
 */
export class OptimizedCoderTask extends CoderTask {
  constructor(options = {}) {
    const optimizedConfig = {
      ...CODER_CONFIG,
      maxSteps: 40,
      maxRepairs: 4,
      repoMapTokens: 8000,
      toolResultTokens: 12000,
      strategy: "auto",
      parallelTools: true,
      speculativeVerification: true,
      adaptiveBatch: true
    };
    
    super({ ...options, config: { ...optimizedConfig, ...options.config } });
    this.speculativeCache = new Map();
    this.parallelExecutions = [];
  }

  /**
   * Ejecuta herramientas en paralelo cuando sea posible
   */
  async executeParallel(calls) {
    const independent = this.findIndependentCalls(calls);
    if (independent.length > 1) {
      const results = await Promise.all(independent.map(c => this.executeTool(c)));
      return this.mergeResults(independent, results);
    }
    return this.executeSequential(calls);
  }

  findIndependentCalls(calls) {
    const independent = [];
    const usedResources = new Set();
    
    for (const call of calls) {
      const resources = this.getCallResources(call);
      const conflicts = resources.some(r => usedResources.has(r));
      if (!conflicts) {
        independent.push(call);
        resources.forEach(r => usedResources.add(r));
      }
    }
    return independent;
  }

  getCallResources(call) {
    const resources = [];
    if (call.name === "leer" || call.name === "reemplazar" || call.name === "archivo") {
      resources.push(`file:${call.arguments.ruta}`);
    } else if (call.name === "ejecutar") {
      resources.push(`cmd:${call.arguments.comando}`);
    } else if (call.name === "buscar" || call.name === "buscar_codigo") {
      resources.push(`search:${call.arguments.consulta || call.arguments.query}`);
    }
    return resources;
  }

  /**
   * Verificación especulativa: ejecuta tests en paralelo con edición
   */
  async speculativeVerify() {
    if (!this.config.speculativeVerification) return this.verify();
    
    const startTime = Date.now();
    const [verification, tests] = await Promise.all([
      this.verify({ final: false }),
      this.runSpeculativeTests()
    ]);
    
    this.trace("speculative_verify", { 
      duration: Date.now() - startTime,
      verificationOk: verification.ok,
      testsRun: tests.length
    });
    
    return verification;
  }

  async runSpeculativeTests() {
    // Run tests in background while continuing
    const testFiles = this.state.modified
      .flatMap(f => this.findRelatedTests(f))
      .slice(0, 3); // Limit concurrent tests
    
    if (testFiles.length === 0) return [];
    
    return Promise.all(testFiles.map(async (f) => {
      try {
        const result = await this.runTestFile(f);
        return { file: f, ...result };
      } catch (e) {
        return { file: f, error: e.message };
      }
    }));
  }

  findRelatedTests(file) {
    const base = file.replace(/\.(js|ts|py)$/, "");
    return [
      `${base}.test.js`, `${base}.test.ts`, `${base}_test.py`,
      `test/${file}.test.js`, `tests/${file}.test.js`
    ].filter(f => this.context.entries.has(f));
  }
}

/**
 * Pipeline de inferencia optimizado
 */
export class OptimizedInferencePipeline {
  constructor(modelPath, config) {
    this.modelPath = modelPath;
    this.config = config;
    this.draftModel = config.draftModel ? new DraftModel(config.draftModel) : null;
    this.kvCache = new OptimizedKVCache(config.kvType);
  }

  async generate(prompt, options = {}) {
    const { maxTokens = 128, temperature = 0.6, speculative = true } = options;
    
    if (speculative && this.draftModel) {
      return this.speculativeGenerate(prompt, maxTokens, temperature);
    }
    return this.standardGenerate(prompt, maxTokens, temperature);
  }

  async speculativeGenerate(prompt, maxTokens, temperature) {
    const tokens = [];
    let remaining = maxTokens;
    
    while (remaining > 0) {
      // Draft model generates multiple tokens
      const draftTokens = await this.draftModel.generate(prompt, Math.min(4, remaining), temperature * 0.5);
      
      // Target model verifies in parallel
      const [accepted, targetTokens] = await this.verifyDraft(prompt, draftTokens, temperature);
      
      tokens.push(...accepted);
      remaining -= accepted.length;
      
      if (accepted.length < draftTokens.length) {
        // Draft was wrong, use target tokens
        tokens.push(...targetTokens.slice(accepted.length));
        break;
      }
      
      // Update prompt with accepted tokens
      prompt = this.appendTokens(prompt, accepted);
    }
    
    return tokens;
  }

  async verifyDraft(prompt, draftTokens, temperature) {
    // Parallel verification of draft tokens
    const results = await Promise.all(
      draftTokens.map((token, i) => 
        this.targetModel.scoreToken(prompt + draftTokens.slice(0, i).join(""), token)
      )
    );
    
    const accepted = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i] > 0.5) { // Acceptance threshold
        accepted.push(draftTokens[i]);
      } else {
        break;
      }
    }
    
    return [accepted, []];
  }
}

/**
 * Draft model for speculative decoding
 */
export class DraftModel {
  constructor(modelPath) {
    this.modelPath = modelPath;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    // Load small model (1B params) for fast draft generation
    this.initialized = true;
  }

  async generate(prompt, maxTokens, temperature) {
    // Fast generation with small model
    return []; // Placeholder
  }
}

/**
 * KV Cache optimizado con cuantización
 */
export class OptimizedKVCache {
  constructor(kvType = "q4_0") {
    this.kvType = kvType;
    this.cache = new Map();
    this.compressionRatio = this.getCompressionRatio(kvType);
  }

  getCompressionRatio(kvType) {
    const ratios = { "f16": 1.0, "q8_0": 2.0, "q4_0": 4.0, "IQ4_XS": 3.55, "IQ2_XS": 7.11, "IQ1_S": 12.8 };
    return ratios[kvType] || 1.0;
  }

  store(key, k, v) {
    if (this.kvType !== "f16") {
      k = this.quantize(k);
      v = this.quantize(v);
    }
    this.cache.set(key, { k, v, type: this.kvType });
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.type !== "f16") {
      return { k: this.dequantize(entry.k), v: this.dequantize(entry.v) };
    }
    return entry;
  }

  quantize(tensor) {
    // Placeholder for actual quantization
    return tensor;
  }

  dequantize(tensor) {
    // Placeholder for actual dequantization
    return tensor;
  }

  getMemoryUsage() {
    let total = 0;
    for (const entry of this.cache.values()) {
      total += JSON.stringify(entry).length;
    }
    return total / this.compressionRatio;
  }
}

export default {
  RTX4060_OPTIMIZED_CONFIG,
  calculateVRAM,
  selectOptimalProfile,
  OptimizedCoderTask,
  OptimizedInferencePipeline,
  DraftModel,
  OptimizedKVCache
};