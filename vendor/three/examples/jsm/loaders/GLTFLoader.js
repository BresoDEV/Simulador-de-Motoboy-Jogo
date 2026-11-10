/**
 * MEXT offline GLTFLoader compatibility build.
 * Implements the GLTFLoader API used by MEXT for common glTF 2.0 / GLB assets.
 * It intentionally has no network dependency beyond URLs explicitly loaded by the game.
 */
import * as THREE from 'three';

const COMPONENT_TYPES = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const ATTRIBUTES = {
  POSITION: 'position', NORMAL: 'normal', TANGENT: 'tangent', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1',
  COLOR_0: 'color', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight',
};

function resolveURL(uri, path = '') {
  if (!uri || /^(data:|blob:|https?:|file:)/i.test(uri)) return uri;
  try { return new URL(uri, path || location.href).href; } catch { return `${path || ''}${uri}`; }
}

function decodeDataURI(uri) {
  const comma = uri.indexOf(',');
  if (comma < 0) throw new Error('Data URI inválida.');
  const meta = uri.slice(0, comma);
  const body = uri.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  return new TextEncoder().encode(decodeURIComponent(body)).buffer;
}

function normalizeComponent(value, componentType) {
  switch (componentType) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32767, -1);
    case 5123: return value / 65535;
    default: return value;
  }
}

class GLTFLoader extends THREE.Loader {
  constructor(manager) {
    super(manager);
    this.dracoLoader = null;
    this.ktx2Loader = null;
    this.meshoptDecoder = null;
  }

  setDRACOLoader(loader) { this.dracoLoader = loader; return this; }
  setKTX2Loader(loader) { this.ktx2Loader = loader; return this; }
  setMeshoptDecoder(decoder) { this.meshoptDecoder = decoder; return this; }
  register() { return this; }
  unregister() { return this; }

  load(url, onLoad, onProgress, onError) {
    const loader = new THREE.FileLoader(this.manager);
    loader.setPath(this.path || '');
    loader.setResponseType('arraybuffer');
    loader.setRequestHeader(this.requestHeader);
    loader.setWithCredentials(this.withCredentials);
    loader.load(url, (data) => {
      const base = this.resourcePath || THREE.LoaderUtils.extractUrlBase(resolveURL(url, this.path || ''));
      this.parse(data, base, onLoad, onError);
    }, onProgress, onError);
  }

  async loadAsync(url, onProgress) {
    return new Promise((resolve, reject) => this.load(url, resolve, onProgress, reject));
  }

  parse(data, path, onLoad, onError) {
    this.parseAsync(data, path).then(onLoad).catch((err) => {
      if (onError) onError(err); else console.error(err);
    });
  }

  async parseAsync(data, path = '') {
    try {
      const { json, binaryChunk } = this._decodeContainer(data);
      if (!json.asset || Number(String(json.asset.version || '0').split('.')[0]) < 2) {
        throw new Error('MEXT GLTFLoader: somente glTF 2.0 ou superior é suportado.');
      }
      if (json.extensionsRequired?.includes('KHR_draco_mesh_compression') && !this.dracoLoader) {
        throw new Error('Este modelo usa Draco. Adicione um DRACOLoader para decodificá-lo.');
      }
      if (json.extensionsRequired?.some((x) => x === 'EXT_meshopt_compression' || x === 'KHR_meshopt_compression') && !this.meshoptDecoder) {
        throw new Error('Este modelo usa Meshopt e requer um decoder Meshopt.');
      }

      const context = await this._createContext(json, binaryChunk, path);
      const scenes = [];
      const cameras = [];
      const sceneDefs = json.scenes?.length ? json.scenes : [{ nodes: json.nodes?.map((_, i) => i) || [] }];
      for (let i = 0; i < sceneDefs.length; i++) {
        const group = new THREE.Group();
        group.name = sceneDefs[i].name || `Scene_${i}`;
        for (const nodeIndex of sceneDefs[i].nodes || []) group.add(await this._buildNode(nodeIndex, context, cameras));
        scenes.push(group);
      }
      const scene = scenes[json.scene ?? 0] || scenes[0] || new THREE.Group();
      scene.userData.gltfAsset = json.asset;
      return { scene, scenes, cameras, animations: [], asset: json.asset, parser: null, userData: {} };
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  _decodeContainer(data) {
    if (typeof data === 'string') return { json: JSON.parse(data), binaryChunk: null };
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.byteLength >= 12) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const magic = view.getUint32(0, true);
      if (magic === 0x46546c67) {
        const version = view.getUint32(4, true);
        if (version !== 2) throw new Error(`GLB versão ${version} não suportada.`);
        const total = Math.min(view.getUint32(8, true), bytes.byteLength);
        let offset = 12, json = null, binaryChunk = null;
        while (offset + 8 <= total) {
          const len = view.getUint32(offset, true);
          const type = view.getUint32(offset + 4, true);
          offset += 8;
          const chunk = bytes.slice(offset, offset + len);
          offset += len;
          if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk).replace(/\0+$/g, '').trim());
          if (type === 0x004e4942) binaryChunk = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
        }
        if (!json) throw new Error('GLB sem chunk JSON.');
        return { json, binaryChunk };
      }
    }
    const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trim();
    return { json: JSON.parse(text), binaryChunk: null };
  }

  async _createContext(json, binaryChunk, path) {
    const buffers = [];
    for (let i = 0; i < (json.buffers?.length || 0); i++) {
      const def = json.buffers[i];
      if (!def.uri) {
        if (!binaryChunk) throw new Error(`Buffer ${i} não encontrado no GLB.`);
        buffers.push(binaryChunk);
      } else if (/^data:/i.test(def.uri)) {
        buffers.push(decodeDataURI(def.uri));
      } else {
        const response = await fetch(resolveURL(def.uri, path));
        if (!response.ok) throw new Error(`Falha ao carregar buffer externo: ${def.uri}`);
        buffers.push(await response.arrayBuffer());
      }
    }
    return { json, buffers, path, accessorCache: new Map(), textureCache: new Map(), materialCache: new Map() };
  }

  _accessor(index, ctx) {
    if (ctx.accessorCache.has(index)) return ctx.accessorCache.get(index);
    const def = ctx.json.accessors?.[index];
    if (!def) throw new Error(`Accessor ${index} inexistente.`);
    const Ctor = COMPONENT_TYPES[def.componentType];
    const itemSize = TYPE_SIZE[def.type];
    if (!Ctor || !itemSize) throw new Error(`Accessor ${index} possui tipo não suportado.`);
    const count = def.count || 0;
    let array = new Ctor(count * itemSize);
    if (def.bufferView !== undefined) {
      const bv = ctx.json.bufferViews?.[def.bufferView];
      if (!bv) throw new Error(`BufferView ${def.bufferView} inexistente.`);
      const buffer = ctx.buffers[bv.buffer];
      const componentBytes = Ctor.BYTES_PER_ELEMENT;
      const packedStride = componentBytes * itemSize;
      const stride = bv.byteStride || packedStride;
      const start = (bv.byteOffset || 0) + (def.byteOffset || 0);
      if (stride === packedStride && start % componentBytes === 0) {
        array.set(new Ctor(buffer, start, count * itemSize));
      } else {
        const dv = new DataView(buffer);
        const getters = { 5120:'getInt8', 5121:'getUint8', 5122:'getInt16', 5123:'getUint16', 5125:'getUint32', 5126:'getFloat32' };
        const getter = getters[def.componentType];
        for (let i = 0; i < count; i++) for (let c = 0; c < itemSize; c++) {
          const off = start + i * stride + c * componentBytes;
          array[i * itemSize + c] = componentBytes === 1 ? dv[getter](off) : dv[getter](off, true);
        }
      }
    }
    if (def.sparse) {
      const s = def.sparse;
      const idxDef = s.indices;
      const idxBV = ctx.json.bufferViews[idxDef.bufferView];
      const IdxCtor = COMPONENT_TYPES[idxDef.componentType];
      const idxStart = (idxBV.byteOffset || 0) + (idxDef.byteOffset || 0);
      const indices = new IdxCtor(ctx.buffers[idxBV.buffer], idxStart, s.count);
      const valBV = ctx.json.bufferViews[s.values.bufferView];
      const valStart = (valBV.byteOffset || 0) + (s.values.byteOffset || 0);
      const values = new Ctor(ctx.buffers[valBV.buffer], valStart, s.count * itemSize);
      for (let i = 0; i < s.count; i++) for (let c = 0; c < itemSize; c++) array[indices[i] * itemSize + c] = values[i * itemSize + c];
    }
    const attr = new THREE.BufferAttribute(array, itemSize, !!def.normalized);
    if (def.min) attr.userData = { ...(attr.userData || {}), min: def.min };
    if (def.max) attr.userData = { ...(attr.userData || {}), max: def.max };
    ctx.accessorCache.set(index, attr);
    return attr;
  }

  async _texture(index, ctx, srgb = false) {
    const key = `${index}:${srgb ? 1 : 0}`;
    if (ctx.textureCache.has(key)) return ctx.textureCache.get(key);
    const texDef = ctx.json.textures?.[index];
    if (!texDef) return null;
    let sourceIndex = texDef.source;
    if (texDef.extensions?.EXT_texture_webp?.source !== undefined) sourceIndex = texDef.extensions.EXT_texture_webp.source;
    if (texDef.extensions?.EXT_texture_avif?.source !== undefined) sourceIndex = texDef.extensions.EXT_texture_avif.source;
    const imgDef = ctx.json.images?.[sourceIndex];
    if (!imgDef) return null;
    let url, revoke = false;
    if (imgDef.uri) {
      url = resolveURL(imgDef.uri, ctx.path);
    } else if (imgDef.bufferView !== undefined) {
      const bv = ctx.json.bufferViews[imgDef.bufferView];
      const src = new Uint8Array(ctx.buffers[bv.buffer], bv.byteOffset || 0, bv.byteLength);
      url = URL.createObjectURL(new Blob([src], { type: imgDef.mimeType || 'application/octet-stream' }));
      revoke = true;
    } else return null;
    const texture = await new THREE.TextureLoader(this.manager).loadAsync(url);
    if (revoke) URL.revokeObjectURL(url);
    texture.flipY = false;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    const sampler = ctx.json.samplers?.[texDef.sampler] || {};
    const wrapMap = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
    const magMap = { 9728: THREE.NearestFilter, 9729: THREE.LinearFilter };
    const minMap = { 9728: THREE.NearestFilter, 9729: THREE.LinearFilter, 9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter, 9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter };
    if (sampler.wrapS) texture.wrapS = wrapMap[sampler.wrapS] || texture.wrapS;
    if (sampler.wrapT) texture.wrapT = wrapMap[sampler.wrapT] || texture.wrapT;
    if (sampler.magFilter) texture.magFilter = magMap[sampler.magFilter] || texture.magFilter;
    if (sampler.minFilter) texture.minFilter = minMap[sampler.minFilter] || texture.minFilter;
    texture.needsUpdate = true;
    ctx.textureCache.set(key, texture);
    return texture;
  }

  async _material(index, ctx) {
    if (index === undefined) return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    if (ctx.materialCache.has(index)) return ctx.materialCache.get(index);
    const def = ctx.json.materials?.[index] || {};
    const pbr = def.pbrMetallicRoughness || {};
    const unlit = !!def.extensions?.KHR_materials_unlit;
    const MaterialClass = unlit ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
    const params = { name: def.name || `Material_${index}` };
    const base = pbr.baseColorFactor || [1,1,1,1];
    params.color = new THREE.Color().setRGB(base[0], base[1], base[2], THREE.LinearSRGBColorSpace);
    params.opacity = base[3] ?? 1;
    if (!unlit) {
      params.metalness = pbr.metallicFactor ?? 1;
      params.roughness = pbr.roughnessFactor ?? 1;
      params.emissive = new THREE.Color().fromArray(def.emissiveFactor || [0,0,0]);
    }
    params.side = def.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    if (def.alphaMode === 'BLEND') { params.transparent = true; params.depthWrite = false; }
    if (def.alphaMode === 'MASK') params.alphaTest = def.alphaCutoff ?? 0.5;
    const material = new MaterialClass(params);
    if (pbr.baseColorTexture) material.map = await this._texture(pbr.baseColorTexture.index, ctx, true);
    if (!unlit && pbr.metallicRoughnessTexture) {
      const t = await this._texture(pbr.metallicRoughnessTexture.index, ctx, false);
      material.metalnessMap = t; material.roughnessMap = t;
    }
    if (!unlit && def.normalTexture) {
      material.normalMap = await this._texture(def.normalTexture.index, ctx, false);
      if (def.normalTexture.scale !== undefined) material.normalScale.setScalar(def.normalTexture.scale);
    }
    if (!unlit && def.occlusionTexture) material.aoMap = await this._texture(def.occlusionTexture.index, ctx, false);
    if (!unlit && def.emissiveTexture) material.emissiveMap = await this._texture(def.emissiveTexture.index, ctx, true);
    material.needsUpdate = true;
    ctx.materialCache.set(index, material);
    return material;
  }

  async _buildPrimitive(def, ctx) {
    const geometry = new THREE.BufferGeometry();
    for (const [semantic, accessorIndex] of Object.entries(def.attributes || {})) {
      const name = ATTRIBUTES[semantic];
      if (name) geometry.setAttribute(name, this._accessor(accessorIndex, ctx));
    }
    if (def.indices !== undefined) geometry.setIndex(this._accessor(def.indices, ctx));
    if (!geometry.getAttribute('normal') && (def.mode === undefined || def.mode === 4)) geometry.computeVertexNormals();
    const material = await this._material(def.material, ctx);
    const mode = def.mode ?? 4;
    let object;
    if (mode === 0) object = new THREE.Points(geometry, material.isPointsMaterial ? material : new THREE.PointsMaterial({ color: material.color || 0xffffff, map: material.map || null, size: 1 }));
    else if (mode === 1) object = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: material.color || 0xffffff, vertexColors: !!geometry.getAttribute('color') }));
    else if (mode === 2) object = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: material.color || 0xffffff, vertexColors: !!geometry.getAttribute('color') }));
    else if (mode === 3) object = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: material.color || 0xffffff, vertexColors: !!geometry.getAttribute('color') }));
    else object = new THREE.Mesh(geometry, material);
    object.castShadow = true; object.receiveShadow = true;
    return object;
  }

  async _buildMesh(index, ctx) {
    const def = ctx.json.meshes?.[index];
    if (!def) return new THREE.Group();
    const parts = [];
    for (const primitive of def.primitives || []) parts.push(await this._buildPrimitive(primitive, ctx));
    let object;
    if (parts.length === 1) object = parts[0];
    else { object = new THREE.Group(); parts.forEach((x) => object.add(x)); }
    object.name = def.name || `Mesh_${index}`;
    return object;
  }

  _buildCamera(index, ctx) {
    const def = ctx.json.cameras?.[index];
    if (!def) return null;
    let camera;
    if (def.type === 'orthographic') {
      const o = def.orthographic;
      camera = new THREE.OrthographicCamera(-o.xmag, o.xmag, o.ymag, -o.ymag, o.znear, o.zfar);
    } else {
      const p = def.perspective || {};
      camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(p.yfov || Math.PI / 3), p.aspectRatio || 1, p.znear || 0.1, p.zfar || 2000);
    }
    camera.name = def.name || `Camera_${index}`;
    return camera;
  }

  async _buildNode(index, ctx, cameras) {
    const def = ctx.json.nodes?.[index] || {};
    let object = null;
    if (def.mesh !== undefined) object = await this._buildMesh(def.mesh, ctx);
    if (def.camera !== undefined) {
      const camera = this._buildCamera(def.camera, ctx);
      if (camera) { cameras.push(camera); if (!object) object = camera; else object.add(camera); }
    }
    if (!object) object = new THREE.Group();
    object.name = def.name || object.name || `Node_${index}`;
    if (def.matrix) {
      object.matrix.fromArray(def.matrix); object.matrix.decompose(object.position, object.quaternion, object.scale);
    } else {
      if (def.translation) object.position.fromArray(def.translation);
      if (def.rotation) object.quaternion.fromArray(def.rotation);
      if (def.scale) object.scale.fromArray(def.scale);
    }
    object.userData = { ...(object.userData || {}), ...(def.extras || {}) };
    for (const childIndex of def.children || []) object.add(await this._buildNode(childIndex, ctx, cameras));
    return object;
  }
}

export { GLTFLoader };
