import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ============================================================
// 草むしり検定実技
// Three.js を使ったブラウザベースの前進型ジャンプアクション
// ============================================================

const C = Object.freeze({
  groundWidth: 22,         // 地面の横幅
  pathHalfWidth: 3.5,      // 土の道の半分幅
  despawnDistance: 60,     // 障害物を消す後方距離
  gravity: -36,            // 重力
  jumpForce: 14,           // ジャンプ力
  playerRadius: 0.5,       // プレイヤー半径
  laneLimit: 6,            // 左右移動の限界
  grassCount: 1400,        // 同時に表示する草の数
  grassSpawnRange: 130,    // 草を生成する先の距離（高速時のため広め）
  grassBehind: 30,         // 草を消す後方距離
  grassCollectRadius: 0.7, // 草をむしる距離
  highGrassChance: 0.08,   // 高得点草の出現率
  treeCount: 420,          // 木の数
  bushCount: 260,          // 下草の茂みの数
  cloudCount: 40,          // 雲の数
});

// 段位（時間で判定）
const RANKS = [
  { label: '検定落ち', duration: 40, minSpeed: 40,  maxSpeed: 60,  color: '#888888' },
  { label: '5級',      duration: 40, minSpeed: 60,  maxSpeed: 80,  color: '#8B4513' },
  { label: '4級',      duration: 40, minSpeed: 80,  maxSpeed: 100, color: '#228B22' },
  { label: '3級',      duration: 30, minSpeed: 100, maxSpeed: 120, color: '#4169E1' },
  { label: '2級',      duration: 30, minSpeed: 120, maxSpeed: 150, color: '#FF8C00' },
  { label: '1級',      duration: 300, minSpeed: 150, maxSpeed: 500, color: '#FFD700' },
];

function getRankByTime(seconds) {
  let idx = 0;
  let t = seconds;
  for (let i = 0; i < RANKS.length; i++) {
    if (t < RANKS[i].duration) {
      idx = i;
      break;
    }
    t -= RANKS[i].duration;
    idx = i + 1;
  }
  return Math.min(idx, RANKS.length - 1);
}

function getRankStartTime(idx) {
  let t = 0;
  for (let i = 0; i < idx; i++) t += RANKS[i].duration;
  return t;
}

function getTargetSpeed(totalTime) {
  const idx = getRankByTime(totalTime);
  const rank = RANKS[idx];
  const rankStart = getRankStartTime(idx);
  const elapsed = totalTime - rankStart;
  const t = Math.min(1, elapsed / rank.duration);
  return THREE.MathUtils.lerp(rank.minSpeed, rank.maxSpeed, t) / 3.6; // km/h -> m/s
}

function getObstacleInterval(speed) {
  // 秒換算でおよそ 1.5〜2.1 秒間隔（以前の1.5倍＝出現数を約3分の2に間引き）
  const seconds = THREE.MathUtils.randFloat(1.5, 2.1);
  return Math.max(21, speed * seconds);
}

// 起伏のある地面の高さを返す連続関数
function terrainHeight(x, z) {
  return Math.sin(x * 0.35 + z * 0.12) * 0.7
       + Math.cos(z * 0.22) * 0.45
       + Math.sin(x * 0.8 + z * 0.06) * 0.2;
}

// 蛇行する道の中心X座標
function pathCenterX(z) {
  return Math.sin(z * 0.04) * 7.0
       + Math.sin(z * 0.015 + 1.2) * 5.0
       + Math.sin(z * 0.08 + 0.5) * 2.0;
}

// 経過時間を「分:秒」で表示
function formatTime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 速度に応じた視覚効果用の補間値（0〜1）
function speedRatio(speed) {
  // 60 km/h ≈ 16.7 m/s でほぼ最大エフェクト
  return THREE.MathUtils.clamp((speed * 3.6 - 40) / 80, 0, 1);
}

// ------------------------------------------------------------
// 入力処理
// ------------------------------------------------------------
class Input {
  constructor() {
    this.left = false;
    this.right = false;
    this.jump = false;
    this.jumpPressed = false;

    window.addEventListener('keydown', e => this._onKey(e, true));
    window.addEventListener('keyup', e => this._onKey(e, false));
    window.addEventListener('touchstart', e => this._onTouch(e), { passive: false });

    this._setupTouchButtons();
  }

  _onKey(e, down) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.left = down;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') this.right = down;

    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (down) {
        if (!this.jump) this.jumpPressed = true;
        this.jump = true;
      } else {
        this.jump = false;
      }
    }
  }

  _onTouch(e) {
    if (e.target.closest && e.target.closest('.panel, .ui-btn')) return;
    e.preventDefault();
    const t = e.touches[0];
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (t.clientY < h * 0.35) {
      if (!this.jump) this.jumpPressed = true;
      this.jump = true;
      setTimeout(() => { this.jump = false; }, 160);
    } else if (t.clientX < w * 0.4) {
      this.left = true;
      setTimeout(() => { this.left = false; }, 150);
    } else if (t.clientX > w * 0.6) {
      this.right = true;
      setTimeout(() => { this.right = false; }, 150);
    }
  }

  _setupTouchButtons() {
    const left = document.getElementById('btn-left');
    const right = document.getElementById('btn-right');
    const jump = document.getElementById('btn-jump');

    const bindBtn = (el, actionDown, actionUp) => {
      if (!el) return;
      el.addEventListener('pointerdown', e => { e.preventDefault(); actionDown(); });
      el.addEventListener('pointerup', e => { e.preventDefault(); actionUp(); });
      el.addEventListener('pointerleave', e => { e.preventDefault(); actionUp(); });
      el.addEventListener('pointercancel', e => { e.preventDefault(); actionUp(); });
    };

    bindBtn(left, () => this.left = true, () => this.left = false);
    bindBtn(right, () => this.right = true, () => this.right = false);
    bindBtn(jump, () => {
      if (!this.jump) this.jumpPressed = true;
      this.jump = true;
    }, () => {
      this.jump = false;
    });
  }

  consumeJump() {
    this.jumpPressed = false;
  }
}

// ------------------------------------------------------------
// プレイヤー（ちいかわ風）
// ------------------------------------------------------------
class Player {
  constructor(scene) {
    this.scene = scene;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.relX = 0; // 道中心からの相対X
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.state = 'running'; // running | falling | bouncing
    this.fallTime = 0;
    this.bounceTime = 0;

    this.jumpStock = 3;
    this.jumpCharge = 0;
    this.jumpChargeInterval = 7;

    this.group = new THREE.Group();

    // ちいかわ風のアニメ調：3段階のトゥーンシェーディング＋細い輪郭線
    const toneData = new Uint8Array([205, 238, 255]);
    const toneMap = new THREE.DataTexture(toneData, toneData.length, 1, THREE.RedFormat);
    toneMap.minFilter = THREE.NearestFilter;
    toneMap.magFilter = THREE.NearestFilter;
    toneMap.needsUpdate = true;
    const bodyMat = new THREE.MeshToonMaterial({ color: 0xfffbf7, emissive: 0x7a7874, gradientMap: toneMap });
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x4a3c3c, side: THREE.BackSide });
    const blackMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const pinkMat = new THREE.MeshBasicMaterial({ color: 0xffa7b6 });

    // 輪郭線：裏面だけを描く少し大きいコピーを重ねる（背面法）
    const outlined = (geo, thickness = 0.022) => {
      const mesh = new THREE.Mesh(geo, bodyMat);
      mesh.castShadow = true;
      geo.computeBoundingSphere();
      const r = geo.boundingSphere.radius;
      const line = new THREE.Mesh(geo, outlineMat);
      line.scale.setScalar(1 + thickness / r);
      mesh.add(line);
      return mesh;
    };

    // 頭：大きくまるい大福のような形（ちいかわは頭が体よりずっと大きい）
    const head = outlined(new THREE.SphereGeometry(0.4, 32, 24));
    head.scale.set(1.12, 0.96, 1.0);
    head.position.set(0, 0.1, 0);
    this.group.add(head);

    // 体：頭の下に小さくずんぐり
    const body = outlined(new THREE.SphereGeometry(0.29, 24, 16));
    body.scale.set(1.0, 0.9, 0.92);
    body.position.set(0, -0.27, -0.01);
    this.group.add(body);

    // 耳：頭のてっぺん左右に小さな丸い耳（少し外向き）
    const earGeo = new THREE.SphereGeometry(0.1, 16, 12);
    earGeo.scale(1, 1.2, 0.75);
    const leftEar = outlined(earGeo, 0.02);
    leftEar.position.set(-0.27, 0.44, -0.02);
    leftEar.rotation.z = 0.45;
    const rightEar = outlined(earGeo, 0.02);
    rightEar.position.set(0.27, 0.44, -0.02);
    rightEar.rotation.z = -0.45;
    this.group.add(leftEar, rightEar);

    // 耳の内側のうっすらピンク（正面側）
    const innerEarGeo = new THREE.SphereGeometry(0.05, 12, 8);
    innerEarGeo.scale(1, 1.3, 0.4);
    const innerEarMat = new THREE.MeshBasicMaterial({ color: 0xffd3dc });
    for (const ear of [leftEar, rightEar]) {
      const inner = new THREE.Mesh(innerEarGeo, innerEarMat);
      inner.position.set(0, 0.0, 0.065);
      ear.add(inner);
    }

    // 顔（正面＋Z）
    const eyeGeo = new THREE.SphereGeometry(0.05, 16, 16);
    eyeGeo.scale(0.85, 1.1, 0.5);
    const leftEye = new THREE.Mesh(eyeGeo, blackMat);
    leftEye.position.set(-0.15, 0.13, 0.39);
    const rightEye = leftEye.clone();
    rightEye.position.set(0.15, 0.13, 0.39);

    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 8, 16, Math.PI), blackMat);
    mouth.position.set(0, 0.02, 0.4);
    mouth.rotation.z = Math.PI;

    const blushGeo = new THREE.SphereGeometry(0.06, 16, 16);
    blushGeo.scale(1.1, 0.6, 0.3);
    const leftBlush = new THREE.Mesh(blushGeo, pinkMat);
    leftBlush.position.set(-0.25, 0.04, 0.34);
    const rightBlush = leftBlush.clone();
    rightBlush.position.set(0.25, 0.04, 0.34);

    this.group.add(leftEye, rightEye, mouth, leftBlush, rightBlush);

    // しっぽ：お尻にちょこんと小さな丸
    const tail = outlined(new THREE.SphereGeometry(0.065, 12, 10), 0.015);
    tail.position.set(0, -0.36, -0.27);
    this.group.add(tail);

    // 腕・脚（ちいかわ風に短く丸い）
    const armGeo = new THREE.CapsuleGeometry(0.075, 0.12, 4, 8);
    const legGeo = new THREE.CapsuleGeometry(0.085, 0.08, 4, 8);

    this.leftArm = new THREE.Group();
    const laMesh = outlined(armGeo, 0.015);
    laMesh.position.set(0, -0.09, 0);
    laMesh.rotation.z = Math.PI / 5;
    this.leftArm.add(laMesh);
    this.leftArm.position.set(-0.27, -0.18, 0.04);
    this.group.add(this.leftArm);

    this.rightArm = new THREE.Group();
    const raMesh = outlined(armGeo, 0.015);
    raMesh.position.set(0, -0.09, 0);
    raMesh.rotation.z = -Math.PI / 5;
    this.rightArm.add(raMesh);
    this.rightArm.position.set(0.27, -0.18, 0.04);
    this.group.add(this.rightArm);

    // 右手にむしった草
    const handGrassGeo = new THREE.ConeGeometry(0.12, 0.45, 5);
    handGrassGeo.translate(0, 0.22, 0);
    const handGrass = new THREE.Mesh(handGrassGeo, new THREE.MeshStandardMaterial({ color: 0x4caf50 }));
    handGrass.position.set(0, -0.2, 0.1);
    handGrass.rotation.x = -Math.PI / 4;
    this.rightArm.add(handGrass);

    this.leftLeg = new THREE.Group();
    const llMesh = outlined(legGeo, 0.015);
    llMesh.position.set(0, -0.06, 0);
    this.leftLeg.add(llMesh);
    this.leftLeg.position.set(-0.13, -0.42, 0.02);
    this.group.add(this.leftLeg);

    this.rightLeg = new THREE.Group();
    const rlMesh = outlined(legGeo, 0.015);
    rlMesh.position.set(0, -0.06, 0);
    this.rightLeg.add(rlMesh);
    this.rightLeg.position.set(0.13, -0.42, 0.02);
    this.group.add(this.rightLeg);

    scene.add(this.group);

    // 転んだ時に頭の上でくるくる回る星（体の回転に影響されないようシーンに直接置く）
    this.stars = new THREE.Group();
    const starGeo = new THREE.OctahedronGeometry(0.09, 0);
    starGeo.scale(1, 1, 0.4);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffd54f });
    for (let i = 0; i < 3; i++) {
      const star = new THREE.Mesh(starGeo, starMat);
      const a = (i / 3) * Math.PI * 2;
      star.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
      this.stars.add(star);
    }
    this.stars.visible = false;
    scene.add(this.stars);
    this.invincible = 0;
    this.actionTime = 0;
  }

  _resetPose() {
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    for (const limb of [this.leftArm, this.rightArm, this.leftLeg, this.rightLeg]) {
      limb.rotation.set(0, 0, 0);
    }
    this.stars.visible = false;
  }

  reset() {
    this.z = 0;
    this.relX = 0;
    this.x = pathCenterX(this.z) + this.relX;
    this.y = terrainHeight(this.x, this.z) + C.playerRadius;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.state = 'running';
    this.fallTime = 0;
    this.bounceTime = 0;
    this.jumpStock = 3;
    this.jumpCharge = 0;
    this.invincible = 0;
    this._resetPose();
    this.group.position.set(this.x, this.y, this.z);
  }

  // 正面からぶつかって、前にころんと転ぶ
  tumble(speed) {
    this.state = 'tumble';
    this.actionTime = 0;
    this.slide = Math.min(speed, 30) * 0.35;
    this.vy = 5.5;
    this.vx = 0;
    this.onGround = false;
  }

  // 落とし穴にすぽっと落ちて、ふちでじたばたもがく
  pitFall(pitX, pitZ, rimY) {
    this.state = 'pit';
    this.actionTime = 0;
    this.pitFrom = new THREE.Vector3(this.x, this.y, this.z);
    this.pitTo = new THREE.Vector3(pitX, rimY - 0.2, pitZ);
    this.vx = 0;
  }

  // ミスのあと、指定位置から走り直す（しばらく点滅して無敵）
  respawn(z, relX) {
    this.state = 'running';
    this.z = z;
    this.relX = relX;
    this.x = pathCenterX(z) + relX;
    this.y = terrainHeight(this.x, z) + C.playerRadius;
    this.vx = 0;
    this.vy = 0;
    this.onGround = true;
    this.invincible = 2.0;
    this._resetPose();
    this.group.position.set(this.x, this.y, this.z);
  }

  _updateTumble(dt, groundY) {
    const t = (this.actionTime += dt);
    // 前へすべりながら止まる
    this.z += this.slide * dt;
    this.slide *= Math.exp(-3.5 * dt);
    this.x = pathCenterX(this.z) + this.relX;

    // 前に1回転してから、うつぶせにべちゃっと倒れる
    const rollEnd = 0.55;
    const k = Math.min(1, t / rollEnd);
    const ease = 1 - Math.pow(1 - k, 3);
    this.group.rotation.x = ease * (Math.PI * 2 + Math.PI / 2);
    this.group.rotation.z = 0;

    // 小さく跳ねてから地面へ（倒れたら体の厚み分だけ浮かせる）
    const lieY = groundY + (k < 1 ? C.playerRadius : 0.36);
    this.vy += C.gravity * dt;
    this.y += this.vy * dt;
    if (this.y <= lieY) {
      this.y = lieY;
      this.vy = this.vy < -4 ? -this.vy * 0.25 : 0;
    }

    // 倒れたあとは手足をぴくぴく
    if (k >= 1) {
      const w = Math.sin(t * 14) * 0.35;
      this.leftArm.rotation.x = -1.2 + w;
      this.rightArm.rotation.x = -1.2 - w;
      this.leftLeg.rotation.x = 0.5 - w;
      this.rightLeg.rotation.x = 0.5 + w;
      // 目を回した星
      this.stars.visible = true;
      this.stars.position.set(this.x, this.y + 0.45, this.z + 0.45);
      this.stars.rotation.y = t * 6;
    } else {
      this.leftArm.rotation.x = -2.4;
      this.rightArm.rotation.x = -2.4;
    }
    this.group.position.set(this.x, this.y, this.z);
  }

  _updatePit(dt) {
    const t = (this.actionTime += dt);
    // 穴の真ん中へ吸い込まれるようにすぽっと落ちる
    const k = Math.min(1, t / 0.35);
    const ease = k * k;
    this.x = THREE.MathUtils.lerp(this.pitFrom.x, this.pitTo.x, k);
    this.z = THREE.MathUtils.lerp(this.pitFrom.z, this.pitTo.z, k);
    this.y = THREE.MathUtils.lerp(this.pitFrom.y, this.pitTo.y, ease);

    if (k >= 1) {
      // ふちから顔だけ出して、両手をばたばた・体を左右にじたばた
      const s = t - 0.35;
      this.y = this.pitTo.y + Math.abs(Math.sin(s * 9)) * 0.12;
      this.group.rotation.z = Math.sin(s * 16) * 0.22;
      this.group.rotation.x = -0.15;
      this.leftArm.rotation.x = -2.7 + Math.sin(s * 24) * 0.7;
      this.rightArm.rotation.x = -2.7 + Math.sin(s * 24 + Math.PI) * 0.7;
      this.leftArm.rotation.z = Math.sin(s * 20) * 0.3;
      this.rightArm.rotation.z = -Math.sin(s * 20) * 0.3;
    } else {
      this.leftArm.rotation.x = -2.9;
      this.rightArm.rotation.x = -2.9;
    }
    this.group.position.set(this.x, this.y, this.z);
  }

  bounceFrom(x) {
    this.state = 'bouncing';
    this.bounceTime = 0;
    // 障害物の中心から離れる方向に大きく弾く
    const dir = this.x >= x ? 1 : -1;
    this.vx = dir * 25;
    this.relX += dir * 1.2;
  }

  update(dt, input, speed, groundY) {
    if (this.state === 'tumble') {
      this._updateTumble(dt, groundY);
      return;
    }
    if (this.state === 'pit') {
      this._updatePit(dt);
      return;
    }
    if (this.invincible > 0) {
      this.invincible -= dt;
      this.group.visible = this.invincible <= 0 || Math.floor(this.invincible * 12) % 2 === 0;
    }

    if (this.state === 'falling') {
      this.fallTime += dt;
      this.vy += C.gravity * dt;
      this.y += this.vy * dt;
      this.z += speed * dt;
      this.x = pathCenterX(this.z) + this.relX;

      // 転倒アニメーション
      this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, -Math.PI / 2, dt * 4);
      this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, Math.PI / 3, dt * 4);
      this.group.position.set(this.x, this.y, this.z);
      return;
    }

    if (this.state === 'bouncing') {
      this.bounceTime += dt;
      this.relX += this.vx * dt;
      this.relX = THREE.MathUtils.clamp(this.relX, -C.laneLimit, C.laneLimit);
      this.vx *= 0.85;
      this.z += speed * dt;
      this.x = pathCenterX(this.z) + this.relX;
      this.vy += C.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= groundY + C.playerRadius) {
        this.y = groundY + C.playerRadius;
        this.vy = 0;
        this.onGround = true;
      }
      if (this.bounceTime > 0.5 && this.onGround) {
        this.state = 'running';
      }
      this.group.position.set(this.x, this.y, this.z);
      this.group.rotation.set(0, 0, THREE.MathUtils.clamp(-this.vx * 0.03, -0.4, 0.4));
      return;
    }

    // 横移動（慣性あり）: 道中心からの相対位置を変える
    let targetVx = 0;
    if (input.left) targetVx += 18;   // 画面左へ = ワールド＋X
    if (input.right) targetVx -= 18;  // 画面右へ = ワールド－X
    this.vx += (targetVx - this.vx) * 8 * dt;
    this.relX += this.vx * dt;
    this.relX = THREE.MathUtils.clamp(this.relX, -C.laneLimit, C.laneLimit);

    // 前進
    this.z += speed * dt;

    // 蛇行する道に沿った位置
    this.x = pathCenterX(this.z) + this.relX;

    // ジャンプチャージ
    if (this.jumpStock < 3) {
      this.jumpCharge += dt;
      while (this.jumpCharge >= this.jumpChargeInterval && this.jumpStock < 3) {
        this.jumpCharge -= this.jumpChargeInterval;
        this.jumpStock++;
      }
    }

    // ジャンプ（ストック消費）
    if (input.jumpPressed && this.jumpStock > 0) {
      this.vy = C.jumpForce;
      this.onGround = false;
      this.jumpStock--;
      input.consumeJump();
    }

    // 重力
    this.vy += C.gravity * dt;
    this.y += this.vy * dt;

    // 地面との衝突
    if (this.y <= groundY + C.playerRadius) {
      this.y = groundY + C.playerRadius;
      this.vy = 0;
      this.onGround = true;
    }

    // 走りながらの上下の揺れ
    const bob = this.onGround ? Math.sin(this.z * 6) * 0.04 : 0;
    this.group.position.set(this.x, this.y + bob, this.z);

    // 体は回転しない
    this.group.rotation.set(0, 0, 0);

    // 腕と脚を動かす
    if (this.onGround) {
      const phase = this.z * 10;
      this.leftArm.rotation.x = Math.sin(phase) * 0.5;
      this.rightArm.rotation.x = Math.sin(phase + Math.PI) * 0.5;
      this.leftLeg.rotation.x = Math.sin(phase + Math.PI) * 0.6;
      this.rightLeg.rotation.x = Math.sin(phase) * 0.6;
    } else {
      // ジャンプ中は両手を上げ、脚をだらんとさせる
      this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, -0.9, dt * 8);
      this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -0.9, dt * 8);
      this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0.3, dt * 8);
      this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0.3, dt * 8);
    }
  }
}

// ------------------------------------------------------------
// 地面（道に沿って曲がる1枚の連続リボン）
// 頂点を x = pathCenterX(z) + 横オフセット で並べ、UV の U を横オフセットから
// 決めることで、土の道テクスチャが蛇行する道に常にぴったり沿う。
// 当たり判定（getGroundHeight）と同じ「横オフセット」基準なので見た目と判定も一致する。
// ------------------------------------------------------------
const GROUND_HALF = 50;      // 描画する地面の半幅（森の奥まで覆う）
const GROUND_BEHIND = 40;    // プレイヤー後方に敷く距離
const GROUND_AHEAD = 230;    // プレイヤー前方に敷く距離
const GROUND_ROW_STEP = 0.5; // 奥行き方向の頂点間隔（丸い落とし穴を表現できる細かさ）
const GROUND_TILE_Z = 16;    // テクスチャ1枚あたりの奥行き(m)

class Ground {
  constructor(scene) {
    this.lastStartZ = null;

    // 横方向の頂点オフセット（道付近は細かく、森の奥は粗く）
    const cols = [];
    for (let x = -10; x <= 10; x += 0.5) cols.push(x);
    for (const x of [11, 12.5, 14.5, 17, 20, 24, 29, 35, 42, GROUND_HALF]) {
      cols.unshift(-x);
      cols.push(x);
    }
    this.cols = cols;
    this.rows = Math.round((GROUND_BEHIND + GROUND_AHEAD) / GROUND_ROW_STEP) + 1;

    const nc = cols.length;
    const nr = this.rows;
    const positions = new Float32Array(nc * nr * 3);
    const uvs = new Float32Array(nc * nr * 2);
    const colors = new Float32Array(nc * nr * 3);
    const indices = [];
    for (let r = 0; r < nr - 1; r++) {
      for (let c = 0; c < nc - 1; c++) {
        const a = r * nc + c;
        const b = a + 1;
        const d = a + nc;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);

    const texture = this._createGroundTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 1.0,
      vertexColors: true, // 落とし穴の内側を暗くする
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  _createGroundTexture() {
    const w = 2048;
    const h = 512;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    const pxPerM = w / (GROUND_HALF * 2);
    const toPx = lx => (lx + GROUND_HALF) * pxPerM;
    const rand = THREE.MathUtils.randFloat;

    // 縦方向にシームレスにするため、上下にはみ出す図形は折り返して2回描く
    const wrapDraw = (y, r, draw) => {
      draw(y);
      if (y - r < 0) draw(y + h);
      if (y + r > h) draw(y - h);
    };

    // 1) 森の床（中央ほど明るい草地、奥ほど暗い苔）
    const floor = ctx.createLinearGradient(0, 0, w, 0);
    const stops = [
      [-GROUND_HALF, '#2f4a1f'],
      [-24, '#3d6127'],
      [-11, '#55822f'],
      [-5, '#629237'],
      [5, '#629237'],
      [11, '#55822f'],
      [24, '#3d6127'],
      [GROUND_HALF, '#2f4a1f'],
    ];
    for (const [lx, col] of stops) floor.addColorStop(toPx(lx) / w, col);
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, w, h);

    // 2) 落ち葉・苔のまだら
    const patchColors = ['rgba(120, 90, 40, 0.18)', 'rgba(60, 90, 30, 0.25)', 'rgba(140, 160, 60, 0.12)', 'rgba(30, 50, 20, 0.2)'];
    for (let i = 0; i < 700; i++) {
      const lx = rand(-GROUND_HALF, GROUND_HALF);
      if (Math.abs(lx) < C.pathHalfWidth + 0.5) continue;
      const x = toPx(lx);
      const y = Math.random() * h;
      const rx = rand(6, 26);
      const ry = rx * rand(0.6, 1.4);
      ctx.fillStyle = patchColors[i % patchColors.length];
      wrapDraw(y, ry, yy => {
        ctx.beginPath();
        ctx.ellipse(x, yy, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // 3) 土の道（縁はゆらぎを付けて自然に。ゆらぎは縦方向に周期的）
    const edgeNoise = (y, seed) => {
      const t = (y / h) * Math.PI * 2;
      return Math.sin(t * 3 + seed) * 0.18 + Math.sin(t * 7 + seed * 2.3) * 0.1 + Math.sin(t * 13 + seed * 0.7) * 0.05;
    };
    const dirt = ctx.createLinearGradient(toPx(-C.pathHalfWidth), 0, toPx(C.pathHalfWidth), 0);
    dirt.addColorStop(0.0, '#8a6a46');
    dirt.addColorStop(0.5, '#a5825a');
    dirt.addColorStop(1.0, '#8a6a46');
    ctx.fillStyle = dirt;
    ctx.beginPath();
    for (let y = 0; y <= h; y += 4) {
      ctx.lineTo(toPx(-C.pathHalfWidth + edgeNoise(y, 1.0)), y);
    }
    for (let y = h; y >= 0; y -= 4) {
      ctx.lineTo(toPx(C.pathHalfWidth + edgeNoise(y, 4.0)), y);
    }
    ctx.closePath();
    ctx.fill();

    // 轍（わだち）
    ctx.strokeStyle = 'rgba(80, 55, 30, 0.22)';
    ctx.lineWidth = pxPerM * 0.45;
    for (const off of [-1.4, 1.4]) {
      ctx.beginPath();
      for (let y = 0; y <= h; y += 4) {
        ctx.lineTo(toPx(off + edgeNoise(y, 2.0 + off) * 0.6), y);
      }
      ctx.stroke();
    }

    // 土の粒・小石
    for (let i = 0; i < 1800; i++) {
      const lx = rand(-C.pathHalfWidth + 0.2, C.pathHalfWidth - 0.2);
      const x = toPx(lx);
      const y = Math.random() * h;
      const r = Math.random() < 0.9 ? rand(0.6, 1.6) : rand(2, 4);
      ctx.fillStyle = Math.random() < 0.5
        ? `rgba(255, 240, 210, ${rand(0.08, 0.22)})`
        : `rgba(60, 40, 20, ${rand(0.08, 0.25)})`;
      wrapDraw(y, r, yy => {
        ctx.beginPath();
        ctx.arc(x, yy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // 4) 道の縁にかかる草（境界をなじませる）
    for (let i = 0; i < 1400; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const y = Math.random() * h;
      const edge = side * C.pathHalfWidth + edgeNoise(y, side < 0 ? 1.0 : 4.0);
      const lx = edge + side * rand(-0.35, 0.6);
      const x = toPx(lx);
      const len = rand(3, 9);
      ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(98, 146, 55, 0.9)' : 'rgba(75, 120, 40, 0.9)';
      ctx.lineWidth = 1.5;
      wrapDraw(y, len, yy => {
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x - side * rand(1, 4), yy - len);
        ctx.stroke();
      });
    }

    // 5) 草地の細かい質感
    for (let i = 0; i < 9000; i++) {
      const lx = rand(-GROUND_HALF, GROUND_HALF);
      if (Math.abs(lx) < C.pathHalfWidth + 0.3) continue;
      const x = toPx(lx);
      const y = Math.random() * h;
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(170, 210, 110, 0.12)' : 'rgba(20, 40, 10, 0.14)';
      ctx.fillRect(x, y, 2, 3);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  update(playerZ, pits = []) {
    // 10m 進むごとに敷き直す（ピットの追加もこのタイミングで反映される）
    const startZ = Math.floor(playerZ / 10) * 10 - GROUND_BEHIND;
    const pitKey = pits.length ? pits[pits.length - 1].z : 0;
    if (this.lastStartZ === startZ && this.lastPitKey === pitKey) return;
    this.lastStartZ = startZ;
    this.lastPitKey = pitKey;
    this._build(startZ, pits);
  }

  _build(startZ, pits) {
    const geo = this.mesh.geometry;
    const pos = geo.attributes.position.array;
    const uv = geo.attributes.uv.array;
    const col = geo.attributes.color.array;
    const cols = this.cols;
    const nc = cols.length;

    let p = 0;
    let q = 0;
    let k = 0;
    for (let r = 0; r < this.rows; r++) {
      const z = startZ + r * GROUND_ROW_STEP;
      const cx = pathCenterX(z);
      // この行にかかる落とし穴だけを候補にする
      const rowPits = pits.filter(pit => Math.abs(z - pit.z) < pit.radius);
      const v = z / GROUND_TILE_Z;
      for (let c = 0; c < nc; c++) {
        const lx = cols[c];
        const x = cx + lx;
        let y = terrainHeight(x, z);
        let shade = 1;
        for (const pit of rowPits) {
          if (Math.hypot(lx - pit.relX, z - pit.z) < pit.radius) {
            y -= 5.0;
            shade = 0.12;
            break;
          }
        }
        pos[p++] = x;
        pos[p++] = y;
        pos[p++] = z;
        uv[q++] = (lx + GROUND_HALF) / (GROUND_HALF * 2);
        uv[q++] = v;
        col[k++] = shade;
        col[k++] = shade;
        col[k++] = shade;
      }
    }

    geo.attributes.position.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
  }
}

// ------------------------------------------------------------
// 落とし穴マネージャー
// ------------------------------------------------------------
class PitManager {
  constructor(scene) {
    this.scene = scene;
    this.pits = [];
    this.nextPitZ = 55;
    this.markerPool = [];

    this.markerGeo = new THREE.TorusGeometry(2.4, 0.3, 8, 36);
    this.markerMat = new THREE.MeshStandardMaterial({
      color: 0xff3d00,
      emissive: 0xff3d00,
      emissiveIntensity: 0.7,
      roughness: 0.4,
    });
    this.warningGeo = new THREE.ConeGeometry(0.45, 1.6, 8);
    this.warningMat = new THREE.MeshBasicMaterial({ color: 0xff1744 });
    this.warningPool = [];
  }

  update(playerZ) {
    while (this.nextPitZ < playerZ + 220) {
      // マーカーの輪と同じくらいの丸い穴を、道幅の中のランダムな位置に
      const radius = THREE.MathUtils.randFloat(1.3, 1.9);
      const relX = THREE.MathUtils.randFloat(-C.laneLimit + 1, C.laneLimit - 1);
      this.pits.push({ z: this.nextPitZ, relX, radius });
      this.nextPitZ += THREE.MathUtils.randFloat(30, 55);
    }

    this.pits = this.pits.filter(p => p.z + p.radius > playerZ - 40);
    this._syncMarkers();
  }

  _syncMarkers() {
    let i = 0;
    const pulse = 1 + Math.sin(performance.now() * 0.01) * 0.12;
    for (const p of this.pits) {
      const cx = pathCenterX(p.z) + p.relX;
      const gy = terrainHeight(cx, p.z);

      let marker;
      if (i < this.markerPool.length) {
        marker = this.markerPool[i];
        marker.visible = true;
      } else {
        marker = new THREE.Mesh(this.markerGeo, this.markerMat);
        marker.rotation.x = -Math.PI / 2;
        marker.frustumCulled = false;
        this.scene.add(marker);
        this.markerPool.push(marker);
      }
      // 輪は穴のふちに沿わせる（ジオメトリ半径 2.4 を穴の大きさに合わせて縮める）
      marker.position.set(cx, gy + 0.25, p.z);
      marker.scale.setScalar(((p.radius + 0.2) / 2.4) * pulse);

      let warning;
      if (i < this.warningPool.length) {
        warning = this.warningPool[i];
        warning.visible = true;
      } else {
        warning = new THREE.Mesh(this.warningGeo, this.warningMat);
        warning.frustumCulled = false;
        this.scene.add(warning);
        this.warningPool.push(warning);
      }
      warning.position.set(cx, gy + 1.2 + (pulse - 1) * 0.8, p.z);
      warning.scale.setScalar(0.7 * pulse);

      i++;
    }
    for (let j = i; j < this.markerPool.length; j++) {
      this.markerPool[j].visible = false;
    }
    for (let j = i; j < this.warningPool.length; j++) {
      this.warningPool[j].visible = false;
    }
  }

  reset() {
    this.pits = [];
    this.nextPitZ = 55;
    this.markerPool.forEach(m => { m.visible = false; });
    this.warningPool.forEach(m => { m.visible = false; });
  }

  // ジャンプせずに穴の上へ来たら、その穴を返す（ふちを少しかすめるくらいは平気）
  pitUnder(player) {
    const gy = terrainHeight(player.x, player.z);
    if (player.y - C.playerRadius > gy + 0.35) return null;
    return this.pits.find(p => Math.hypot(player.x - (pathCenterX(p.z) + p.relX), player.z - p.z) < p.radius - 0.25) || null;
  }

  // 復帰位置の前後にある穴を取り除く
  clearAround(z0, z1) {
    this.pits = this.pits.filter(p => p.z + p.radius < z0 || p.z - p.radius > z1);
  }

  // 穴の近く（ふちから margin 以内）かどうか
  isNearPit(x, z, margin = 1.0) {
    return this.pits.some(p => Math.hypot(x - (pathCenterX(p.z) + p.relX), z - p.z) < p.radius + margin);
  }

  getGroundHeight(x, z) {
    for (const p of this.pits) {
      if (Math.hypot(x - (pathCenterX(z) + p.relX), z - p.z) < p.radius) {
        return terrainHeight(x, z) - 5.0;
      }
    }
    return terrainHeight(x, z);
  }
}

// ------------------------------------------------------------
// 横衝突時の草飛び散りエフェクト
// ------------------------------------------------------------
class GrassBurst {
  constructor(scene, x, y, z) {
    this.scene = scene;
    this.life = 1.0;
    this.particles = [];
    this.group = new THREE.Group();

    const geo = new THREE.ConeGeometry(0.06, 0.28, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0x66bb6a, side: THREE.DoubleSide });

    for (let i = 0; i < 18; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 0.7
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        Math.random() * 7 + 2,
        (Math.random() - 0.5) * 12
      );
      this.group.add(mesh);
      this.particles.push({ mesh, v });
    }

    this.group.position.set(x, y, z);
    this.group.frustumCulled = false;
    scene.add(this.group);
  }

  update(dt) {
    this.life -= dt;
    for (const p of this.particles) {
      p.v.y += -20 * dt;
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.rotation.x += dt * 5;
      p.mesh.rotation.z += dt * 5;
    }
    return this.life > 0;
  }

  dispose() {
    this.scene.remove(this.group);
  }
}

// 昇級の横断幕の寸法
const BANNER_SPAN = 15;        // ポールの間隔（キワの障害物より外側）
const BANNER_POLE_HEIGHT = 9.5;
const BANNER_Y = 7.6;          // 横断幕の中心の高さ
const BANNER_HEIGHT = 2.2;

// ------------------------------------------------------------
// 昇級ゲート（高い位置に張った横断幕）
// ------------------------------------------------------------
class GateManager {
  constructor(scene) {
    this.scene = scene;
    this.gate = null;

    // 横断幕を張る2本のポール（紅白のしま模様）と、てっぺんの飾り玉
    this.poleGeo = new THREE.CylinderGeometry(0.16, 0.2, BANNER_POLE_HEIGHT, 10);
    this.poleGeo.translate(0, BANNER_POLE_HEIGHT / 2, 0);
    this.poleMat = new THREE.MeshStandardMaterial({ map: this._stripeTexture(), roughness: 0.6 });
    this.knobGeo = new THREE.SphereGeometry(0.32, 16, 12);
    this.ropeMat = new THREE.LineBasicMaterial({ color: 0x5b4636 });
    this.flagGeo = new THREE.BufferGeometry();
    this.flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.32, 0, 0, 0.32, 0, 0, 0, -0.75, 0], 3));
    this.flagGeo.computeVertexNormals();
    this.flagColors = [0xffb3c1, 0xfff1a8, 0xb9e8a5, 0xb8dcff, 0xffd2a8].map(c =>
      new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
  }

  _stripeTexture() {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#ff8fab';
      ctx.fillRect(0, i * 8, 4, 8);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 4);
    return tex;
  }

  // 横断幕の布に描く文字
  _bannerTexture(rank) {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 224;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(0, 0, c.width, c.height);
    // 段位の色のふち取り
    ctx.strokeStyle = rank.color;
    ctx.lineWidth = 22;
    ctx.strokeRect(11, 11, c.width - 22, c.height - 22);
    ctx.strokeStyle = '#5b4636';
    ctx.lineWidth = 5;
    ctx.strokeRect(26, 26, c.width - 52, c.height - 52);

    const font = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 104px ${font}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#5b4636';
    const text = `祝 ${rank.label} 昇級！`;
    ctx.strokeText(text, c.width / 2, c.height / 2 + 6);
    ctx.fillStyle = rank.color;
    ctx.fillText(text, c.width / 2, c.height / 2 + 6);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  spawn(z, rank) {
    this.clear();
    const cx = pathCenterX(z);
    const group = new THREE.Group();
    group.position.set(cx, terrainHeight(cx, z), z);
    // 道の向きに合わせて少し回す
    const dx = pathCenterX(z + 0.5) - pathCenterX(z - 0.5);
    group.rotation.y = Math.atan2(dx, 1);
    this.scene.add(group);

    const half = BANNER_SPAN / 2;
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
      pole.position.x = side * half;
      pole.castShadow = true;
      group.add(pole);
      const knob = new THREE.Mesh(this.knobGeo, new THREE.MeshStandardMaterial({ color: rank.color, roughness: 0.4 }));
      knob.position.set(side * half, BANNER_POLE_HEIGHT + 0.2, 0);
      group.add(knob);
    }

    // 横断幕（風でゆれるよう細かく分割）
    const clothW = BANNER_SPAN - 1.2;
    const clothGeo = new THREE.PlaneGeometry(clothW, BANNER_HEIGHT, 32, 4);
    const texture = this._bannerTexture(rank);
    const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({
      map: texture,
      side: THREE.DoubleSide,
      roughness: 0.9,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: 0.35, // 夜でも読めるように少し自発光
    }));
    cloth.position.y = BANNER_Y;
    cloth.rotation.y = Math.PI; // 文字をプレイヤー側（-Z）に向ける
    cloth.castShadow = true;
    group.add(cloth);
    const basePos = clothGeo.attributes.position.array.slice();

    // 横断幕を吊るすロープと、その下のガーランド旗
    const topY = BANNER_Y + BANNER_HEIGHT / 2;
    const rope = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-half, BANNER_POLE_HEIGHT - 0.2, 0),
        new THREE.Vector3(-clothW / 2, topY, 0),
        new THREE.Vector3(clothW / 2, topY, 0),
        new THREE.Vector3(half, BANNER_POLE_HEIGHT - 0.2, 0),
      ]),
      this.ropeMat,
    );
    group.add(rope);

    const flags = [];
    const garlandY = BANNER_Y - BANNER_HEIGHT / 2 - 0.5;
    const garlandPts = [];
    const n = 15;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = -half + t * BANNER_SPAN;
      const y = garlandY - Math.sin(t * Math.PI) * 0.7; // ゆるくたるませる
      garlandPts.push(new THREE.Vector3(x, y, 0));
      if (i > 0 && i < n) {
        const flag = new THREE.Mesh(this.flagGeo, this.flagColors[i % this.flagColors.length]);
        flag.position.set(x, y, 0);
        group.add(flag);
        flags.push(flag);
      }
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(garlandPts), this.ropeMat));

    this.gate = { z, group, cloth, basePos, flags, texture, born: performance.now() };
  }

  clear() {
    if (!this.gate) return;
    const g = this.gate;
    this.scene.remove(g.group);
    g.group.traverse(o => {
      // 共有しているジオメトリ・マテリアルは残す
      if (o.geometry && o.geometry !== this.poleGeo && o.geometry !== this.knobGeo && o.geometry !== this.flagGeo) {
        o.geometry.dispose();
      }
      if (o.material && o.material !== this.poleMat && o.material !== this.ropeMat && !this.flagColors.includes(o.material)) {
        o.material.dispose();
      }
    });
    g.texture.dispose();
    this.gate = null;
  }

  update(dt, playerZ) {
    if (!this.gate) return;
    if (playerZ > this.gate.z + 8) {
      this.clear();
      return;
    }
    // 布と旗を風でゆらす
    const t = (performance.now() - this.gate.born) / 1000;
    const pos = this.gate.cloth.geometry.attributes.position;
    const base = this.gate.basePos;
    const halfW = (BANNER_SPAN - 1.2) / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const pin = 1 - Math.pow(Math.abs(x) / halfW, 4); // 両端は留めてあるので動かさない
      const sag = (0.5 - y / BANNER_HEIGHT) * 0.5 + 0.5; // 下の方がよくゆれる
      pos.array[i * 3 + 2] = Math.sin(x * 0.9 + t * 3.2) * 0.18 * pin * sag;
    }
    pos.needsUpdate = true;
    this.gate.flags.forEach((f, i) => {
      f.rotation.x = Math.sin(t * 4 + i * 0.7) * 0.35;
    });
  }
}

// ------------------------------------------------------------
// 草（7種類の形を種類ごとの InstancedMesh で描画）
// スロット i の形は i % 種類数 で固定し、再生成しても同じメッシュ内で使い回す
// ------------------------------------------------------------

// 先細りの葉・草の葉身を作る（profile で幅の変化、bend で反り具合を決める）
function grassRibbon({ len, width, bend = 0.6, seg = 5, profile = t => 1 - t, tilt = 0, dir = 0, x = 0, y = 0, z = 0 }) {
  const positions = [];
  const indices = [];
  let py = 0;
  let pz = 0;
  const dl = len / seg;
  for (let k = 0; k <= seg; k++) {
    const t = k / seg;
    const w = width * profile(t) * 0.5;
    positions.push(-w, py, pz, w, py, pz);
    const phi = bend * t;
    py += dl * Math.cos(phi);
    pz += dl * Math.sin(phi);
    if (k < seg) {
      const a = k * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.rotateX(tilt);
  g.rotateY(dir);
  g.translate(x, y, z);
  g.computeVertexNormals();
  return g;
}

// 葉っぱ型（根元と先が細く、中ほどが太い）
const leafProfile = t => Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.05)) * (1 - t * 0.3);

// プリミティブを草用にそろえる（uv を外してマージ可能にする）
function grassPart(g) {
  g.deleteAttribute('uv');
  return g;
}

class Grass {
  constructor(scene, playerZ) {
    this.scene = scene;
    this.count = C.grassCount;

    const shapes = this._createGrassShapes();
    this.shapeCount = shapes.length;

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });

    this.meshes = shapes.map((geo, k) => {
      const n = Math.ceil((this.count - k) / shapes.length);
      const mesh = new THREE.InstancedMesh(geo, material, n);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    });

    this.data = [];
    this.reset(playerZ);
  }

  _createGrassShapes() {
    const rand = THREE.MathUtils.randFloat;
    const shapes = [];

    // 0) 細い葉が放射状に広がる草むら
    const clump = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2);
      clump.push(grassRibbon({ len: rand(0.45, 0.7), width: 0.1, bend: rand(0.6, 1.1), tilt: rand(0.1, 0.35), dir: a }));
    }
    shapes.push(mergeGeometries(clump));

    // 1) 背の高いススキ風（長い葉が大きくしなる）
    const tall = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand(-0.3, 0.3);
      tall.push(grassRibbon({ len: rand(0.75, 1.05), width: 0.085, bend: rand(1.0, 1.5), seg: 7, tilt: rand(0.05, 0.2), dir: a }));
    }
    shapes.push(mergeGeometries(tall));

    // 2) 双葉 🌱
    const sprout = [grassPart(new THREE.CylinderGeometry(0.018, 0.025, 0.32, 5).translate(0, 0.16, 0))];
    for (const s of [-1, 1]) {
      sprout.push(grassRibbon({ len: 0.24, width: 0.17, bend: -0.5, profile: leafProfile, tilt: 1.15, dir: s * Math.PI / 2, y: 0.3 }));
    }
    shapes.push(mergeGeometries(sprout));

    // 3) オオバコ風の広い葉（地面にロゼット状に広がる）
    const rosette = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand(-0.2, 0.2);
      rosette.push(grassRibbon({ len: rand(0.32, 0.42), width: 0.2, bend: 0.5, profile: leafProfile, tilt: rand(0.7, 1.0), dir: a }));
    }
    shapes.push(mergeGeometries(rosette));

    // 4) クローバー 🍀（細い茎の先に3枚のハート形の葉）
    const clover = [];
    for (let j = 0; j < 3; j++) {
      const ox = rand(-0.12, 0.12);
      const oz = rand(-0.12, 0.12);
      const h = rand(0.22, 0.34);
      clover.push(grassPart(new THREE.CylinderGeometry(0.012, 0.015, h, 4).translate(ox, h / 2, oz)));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + j;
        const leaf = grassPart(new THREE.CircleGeometry(0.075, 8));
        leaf.scale(1, 0.85, 1);
        leaf.rotateX(-Math.PI / 2 + 0.25);
        leaf.translate(0, 0, 0.065);
        leaf.rotateY(a);
        leaf.translate(ox, h, oz);
        clover.push(leaf);
      }
    }
    shapes.push(mergeGeometries(clover));

    // 5) ねこじゃらし（ふさふさの穂と細い葉）
    const foxtail = [];
    for (let i = 0; i < 2; i++) {
      const lean = rand(-0.25, 0.25);
      const ox = i === 0 ? -0.05 : 0.06;
      const stem = grassPart(new THREE.CylinderGeometry(0.012, 0.018, 0.75, 4).translate(0, 0.375, 0));
      const head = grassPart(new THREE.CapsuleGeometry(0.05, 0.16, 3, 6).translate(0, 0.8, 0));
      for (const g of [stem, head]) {
        g.rotateZ(lean);
        g.translate(ox, 0, 0);
        foxtail.push(g);
      }
    }
    for (let i = 0; i < 4; i++) {
      foxtail.push(grassRibbon({ len: rand(0.35, 0.5), width: 0.06, bend: 1.1, tilt: 0.2, dir: (i / 4) * Math.PI * 2 }));
    }
    shapes.push(mergeGeometries(foxtail));

    // 6) 小さな花の咲く草
    const flower = [];
    flower.push(grassPart(new THREE.CylinderGeometry(0.015, 0.02, 0.4, 5).translate(0, 0.2, 0)));
    for (let i = 0; i < 5; i++) {
      const petal = grassPart(new THREE.SphereGeometry(0.06, 6, 4));
      petal.scale(0.6, 0.2, 1);
      const a = (i / 5) * Math.PI * 2;
      petal.translate(Math.cos(a) * 0.065, 0.42, Math.sin(a) * 0.065);
      flower.push(petal);
    }
    flower.push(grassPart(new THREE.SphereGeometry(0.035, 6, 4).translate(0, 0.43, 0)));
    for (let i = 0; i < 4; i++) {
      flower.push(grassRibbon({ len: 0.22, width: 0.09, bend: 0.6, profile: leafProfile, tilt: 0.9, dir: (i / 4) * Math.PI * 2 + 0.4 }));
    }
    shapes.push(mergeGeometries(flower));

    return shapes;
  }

  _randomRelX() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const relX = THREE.MathUtils.randFloat(-C.groundWidth / 2 + 0.6, C.groundWidth / 2 - 0.6);
      const onPath = Math.abs(relX) < C.pathHalfWidth;
      if (onPath) {
        // 道の上はごく稀に草を生やす
        if (Math.random() < 0.12) return relX;
      } else {
        return relX;
      }
    }
    return THREE.MathUtils.randFloat(C.pathHalfWidth + 0.3, C.groundWidth / 2 - 0.6) * (Math.random() < 0.5 ? -1 : 1);
  }

  _generate(i, z) {
    const relX = this._randomRelX();
    const x = pathCenterX(z) + relX;
    const onPath = Math.abs(relX) < C.pathHalfWidth;
    const high = !onPath && Math.random() < C.highGrassChance;
    return {
      x,
      z,
      relX,
      score: high ? 5 : 1,
      high,
      shape: i % this.shapeCount,
      active: true,
    };
  }

  _grassColor(d) {
    if (d.high) return new THREE.Color(0xffd700);
    const palettes = [
      [0x43a047, 0x66bb6a], // 若草
      [0x7c9a3a, 0xa5b85a], // ススキっぽい黄緑
      [0x4caf50, 0x81c784], // 双葉の明るい緑
      [0x2e7d32, 0x4caf50], // 深緑
      [0x388e3c, 0x5c9e3a], // クローバー
      [0x689f38, 0x8bc34a], // ねこじゃらし
      [0x558b2f, 0x7cb342], // 花の草
    ];
    const [base, light] = palettes[d.shape % palettes.length];
    return new THREE.Color(base).lerp(new THREE.Color(light), Math.random() * 0.5);
  }

  _setInstance(i, matrix, color) {
    const mesh = this.meshes[i % this.shapeCount];
    const j = Math.floor(i / this.shapeCount);
    mesh.setMatrixAt(j, matrix);
    if (color) mesh.setColorAt(j, color);
  }

  _placeInstance(dummy, i) {
    const d = this.data[i];
    // 落とし穴の中には生やさない（次のフレームで別の場所に生え直す）
    if (this.avoid && this.avoid(d.x, d.z)) {
      d.active = false;
      this._setInstance(i, new THREE.Matrix4().makeScale(0, 0, 0));
      return;
    }
    const y = terrainHeight(d.x, d.z);
    dummy.position.set(d.x, y, d.z);
    const onPath = Math.abs(d.relX) < C.pathHalfWidth;
    // 道の上は低く疎に、草地は大きく密に
    const baseScale = d.high ? 1.6 : (onPath ? THREE.MathUtils.randFloat(0.9, 1.2) : THREE.MathUtils.randFloat(1.4, 1.9));
    const heightScale = onPath ? THREE.MathUtils.randFloat(0.55, 0.8) : THREE.MathUtils.randFloat(1.1, 1.5);
    dummy.scale.set(baseScale, heightScale, baseScale);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.updateMatrix();
    this._setInstance(i, dummy.matrix, this._grassColor(d));
  }

  _flag() {
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  reset(playerZ) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.count; i++) {
      const z = playerZ + THREE.MathUtils.randFloat(-C.grassBehind, C.grassSpawnRange);
      this.data[i] = this._generate(i, z);
      this._placeInstance(dummy, i);
    }
    this._flag();
  }

  update(player, onCollect) {
    const dummy = new THREE.Object3D();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    let changed = false;

    for (let i = 0; i < this.count; i++) {
      const d = this.data[i];

      if (d.active) {
        const dx = player.x - d.x;
        const dz = player.z - d.z;
        const distXZ = Math.hypot(dx, dz);
        const dy = player.y - (terrainHeight(d.x, d.z) + 0.35);

        if (distXZ < C.grassCollectRadius && Math.abs(dy) < 1.2) {
          d.active = false;
          this._setInstance(i, hidden);
          changed = true;
          onCollect(d);
        }
      }

      if (!d.active || d.z < player.z - C.grassBehind) {
        const z = player.z + THREE.MathUtils.randFloat(20, C.grassSpawnRange + 20);
        this.data[i] = this._generate(i, z);
        this._placeInstance(dummy, i);
        changed = true;
      }
    }

    if (changed) this._flag();
  }
}

// ------------------------------------------------------------
// 森（針葉樹・広葉樹・下草の茂み）
// 前後 FOREST_RANGE の帯に配置し、後ろに抜けた木は同じ間隔のまま前方へ送る
// ------------------------------------------------------------
const FOREST_BEHIND = 30;
const FOREST_RANGE = 210;

class Forest {
  constructor(scene, playerZ) {
    this.count = C.treeCount;
    this.bushCount = C.bushCount;

    // 幹（全種類共通、高さはインスタンスのスケールで変える）
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 1, 7);
    trunkGeo.translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.95 });

    // 針葉樹の葉（3段の円錐）
    const coneParts = [
      [2.3, 4.0, 3.6],
      [1.85, 3.4, 5.7],
      [1.3, 2.8, 7.6],
    ].map(([r, hgt, y]) => {
      const g = new THREE.ConeGeometry(r, hgt, 8);
      g.translate(0, y, 0);
      return g;
    });
    const coniferGeo = mergeGeometries(coneParts);

    // 広葉樹の葉（丸いかたまりの集合）
    const blobParts = [
      [0, 6.2, 0, 2.3],
      [1.4, 5.5, 0.6, 1.7],
      [-1.3, 5.6, -0.5, 1.8],
      [0.3, 7.6, 0.2, 1.7],
      [-0.5, 5.4, 1.3, 1.5],
    ].map(([x, y, z, r]) => {
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.translate(x, y, z);
      return g;
    });
    const broadGeo = mergeGeometries(blobParts);

    const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });

    // 下草の茂み
    const bushParts = [
      [0, 0.35, 0, 0.6],
      [0.5, 0.3, 0.2, 0.45],
      [-0.45, 0.28, -0.15, 0.5],
    ].map(([x, y, z, r]) => {
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.translate(x, y, z);
      return g;
    });
    const bushGeo = mergeGeometries(bushParts);

    const make = (geo, mat, n) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.trunkMesh = make(trunkGeo, trunkMat, this.count);
    this.coniferMesh = make(coniferGeo, foliageMat, this.count);
    this.broadMesh = make(broadGeo, foliageMat, this.count);
    this.bushMesh = make(bushGeo, foliageMat, this.bushCount);
    this.bushMesh.castShadow = false;

    this.dummy = new THREE.Object3D();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.trees = [];
    this.bushes = [];
    this.reset(playerZ);
  }

  reset(playerZ) {
    for (let i = 0; i < this.count; i++) {
      const z = playerZ - FOREST_BEHIND + (i / this.count) * FOREST_RANGE + Math.random() * 2;
      this.trees[i] = this._generateTree(z);
      this._applyTree(i);
    }
    for (let i = 0; i < this.bushCount; i++) {
      const z = playerZ - FOREST_BEHIND + Math.random() * FOREST_RANGE;
      this.bushes[i] = this._generateBush(z);
      this._applyBush(i);
    }
    this._flag();
  }

  _generateTree(z) {
    const side = Math.random() < 0.5 ? -1 : 1;
    // 道の近くほど密度を高く（9m〜46m）
    const relX = side * (9.5 + Math.pow(Math.random(), 1.5) * 36);
    const conifer = Math.random() < 0.6;
    const hue = conifer ? THREE.MathUtils.randFloat(0.3, 0.37) : THREE.MathUtils.randFloat(0.22, 0.32);
    const light = conifer ? THREE.MathUtils.randFloat(0.18, 0.27) : THREE.MathUtils.randFloat(0.24, 0.36);
    return {
      x: pathCenterX(z) + relX,
      z,
      relX,
      conifer,
      scale: THREE.MathUtils.randFloat(0.9, 1.8),
      rot: Math.random() * Math.PI * 2,
      color: new THREE.Color().setHSL(hue, 0.55, light),
    };
  }

  _generateBush(z) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const relX = side * THREE.MathUtils.randFloat(7.5, 22);
    return {
      x: pathCenterX(z) + relX,
      z,
      scale: THREE.MathUtils.randFloat(0.8, 2.0),
      rot: Math.random() * Math.PI * 2,
      color: new THREE.Color().setHSL(THREE.MathUtils.randFloat(0.24, 0.33), 0.5, THREE.MathUtils.randFloat(0.22, 0.34)),
    };
  }

  _applyTree(i) {
    const t = this.trees[i];
    const d = this.dummy;
    const y = terrainHeight(t.x, t.z) - 0.2;
    const trunkH = (t.conifer ? 3.0 : 4.6) * t.scale;

    d.position.set(t.x, y, t.z);
    d.rotation.set(0, t.rot, 0);
    d.scale.set(t.scale, trunkH, t.scale);
    d.updateMatrix();
    this.trunkMesh.setMatrixAt(i, d.matrix);

    d.scale.setScalar(t.scale);
    d.updateMatrix();
    if (t.conifer) {
      this.coniferMesh.setMatrixAt(i, d.matrix);
      this.coniferMesh.setColorAt(i, t.color);
      this.broadMesh.setMatrixAt(i, this.zero);
    } else {
      this.broadMesh.setMatrixAt(i, d.matrix);
      this.broadMesh.setColorAt(i, t.color);
      this.coniferMesh.setMatrixAt(i, this.zero);
    }
  }

  _applyBush(i) {
    const b = this.bushes[i];
    const d = this.dummy;
    d.position.set(b.x, terrainHeight(b.x, b.z) - 0.1, b.z);
    d.rotation.set(0, b.rot, 0);
    d.scale.set(b.scale, b.scale * 0.8, b.scale);
    d.updateMatrix();
    this.bushMesh.setMatrixAt(i, d.matrix);
    this.bushMesh.setColorAt(i, b.color);
  }

  _flag() {
    for (const m of [this.trunkMesh, this.coniferMesh, this.broadMesh, this.bushMesh]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  update(playerZ) {
    let changed = false;
    const limit = playerZ - FOREST_BEHIND;
    for (let i = 0; i < this.count; i++) {
      const t = this.trees[i];
      if (t.z < limit) {
        // 等間隔を保つため、帯の長さ分だけ前へ送る
        const z = t.z + FOREST_RANGE * Math.ceil((limit - t.z) / FOREST_RANGE);
        this.trees[i] = this._generateTree(z);
        this._applyTree(i);
        changed = true;
      }
    }
    for (let i = 0; i < this.bushCount; i++) {
      const b = this.bushes[i];
      if (b.z < limit) {
        const z = b.z + FOREST_RANGE * Math.ceil((limit - b.z) / FOREST_RANGE);
        this.bushes[i] = this._generateBush(z);
        this._applyBush(i);
        changed = true;
      }
    }
    if (changed) this._flag();
  }
}

// ------------------------------------------------------------
// 木漏れ日（梢から差し込む光の筋）
// ------------------------------------------------------------
class SunBeams {
  constructor(scene, playerZ) {
    this.count = 16;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gx = ctx.createLinearGradient(0, 0, 64, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)');
    gx.addColorStop(0.5, 'rgba(255,255,255,1)');
    gx.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gx;
    ctx.fillRect(0, 0, 64, 256);
    // 上ほど明るく、地面に近づくほど消える
    ctx.globalCompositeOperation = 'destination-in';
    const gy = ctx.createLinearGradient(0, 0, 0, 256);
    gy.addColorStop(0, 'rgba(0,0,0,0.9)');
    gy.addColorStop(0.7, 'rgba(0,0,0,0.35)');
    gy.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gy;
    ctx.fillRect(0, 0, 64, 256);
    const tex = new THREE.CanvasTexture(canvas);

    this.material = new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xfff3c4,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, -0.5, 0); // 上端を基準にする

    this.beams = [];
    for (let i = 0; i < this.count; i++) {
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const b = { mesh, z: 0 };
      this._place(b, playerZ - 20 + (i / this.count) * 180);
      this.beams.push(b);
    }
  }

  _place(b, z) {
    b.z = z;
    const relX = THREE.MathUtils.randFloat(-14, 14);
    const x = pathCenterX(z) + relX;
    const topY = terrainHeight(x, z) + THREE.MathUtils.randFloat(11, 15);
    b.mesh.position.set(x, topY, z);
    b.mesh.scale.set(THREE.MathUtils.randFloat(1.5, 4.5), topY - terrainHeight(x, z) + 2, 1);
    b.mesh.rotation.set(0, THREE.MathUtils.randFloat(-0.4, 0.4), -0.35);
  }

  update(playerZ) {
    for (const b of this.beams) {
      if (b.z < playerZ - 20) this._place(b, b.z + 180);
    }
  }

  reset(playerZ) {
    this.beams.forEach((b, i) => this._place(b, playerZ - 20 + (i / this.count) * 180));
  }
}

// ------------------------------------------------------------
// スピードライン（速度感演出）
// ------------------------------------------------------------
class SpeedLines {
  constructor(scene) {
    this.scene = scene;
    this.count = 500;
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.count * 3);

    for (let i = 0; i < this.count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = Math.random() * 8;
      positions[i * 3 + 2] = Math.random() * 120 - 20;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.08,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt, playerZ, speed) {
    const sr = speedRatio(speed);
    this.material.opacity = 0.25 + sr * 0.55;
    this.material.size = 0.06 + sr * 0.14;

    const positions = this.geometry.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      positions[i * 3 + 2] -= speed * dt * (1 + sr * 0.8);
      if (positions[i * 3 + 2] < playerZ - 25) {
        positions[i * 3] = (Math.random() - 0.5) * (24 + sr * 20);
        positions[i * 3 + 1] = Math.random() * (10 + sr * 8) + 0.5;
        positions[i * 3 + 2] = playerZ + 80 + Math.random() * 60;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}

// ------------------------------------------------------------
// 障害物（岩・箱）
// ------------------------------------------------------------
class Obstacles {
  constructor(scene) {
    this.scene = scene;
    this.items = [];

    this.geometries = {
      crate: new THREE.BoxGeometry(1, 1, 1),
      rock: new THREE.DodecahedronGeometry(0.7),
      stump: new THREE.CylinderGeometry(0.45, 0.58, 0.9, 10),
    };

    this.materials = {
      crate: new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.7, emissive: 0x550000, emissiveIntensity: 0.3 }),
      rock: new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.8, emissive: 0x3e2723, emissiveIntensity: 0.25 }),
      stump: new THREE.MeshStandardMaterial({ color: 0x7b5232, roughness: 0.9, emissive: 0x2a1608, emissiveIntensity: 0.3 }),
    };

    // 障害物の目印（赤い輪）
    this.markerGeo = new THREE.TorusGeometry(0.85, 0.08, 6, 24);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.8 });
    this.markers = [];
  }

  _marker(index) {
    if (index < this.markers.length) return this.markers[index];
    const mesh = new THREE.Mesh(this.markerGeo, this.markerMat.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.markers.push(mesh);
    return mesh;
  }

  spawn(type, z, x) {
    // 落とし穴に重なる位置には置かない
    if (this.avoid && this.avoid(x, z)) return;
    let item = this.items.find(i => !i.active && i.type === type);
    if (!item) {
      const mesh = new THREE.Mesh(this.geometries[type], this.materials[type]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      item = { mesh, type, active: false };
      this.items.push(item);
    }

    item.active = true;
    item.mesh.visible = true;

    const gy = terrainHeight(x, z);
    if (type === 'crate') {
      item.mesh.position.set(x, gy + 0.5, z);
      item.radius = 0.6;
      item.height = 1.0;
    } else if (type === 'rock') {
      item.mesh.position.set(x, gy + 0.55, z);
      item.radius = 0.65;
      item.height = 1.0;
    } else if (type === 'stump') {
      item.mesh.position.set(x, gy + 0.45, z);
      item.mesh.rotation.y = Math.random() * Math.PI;
      item.radius = 0.6;
      item.height = 0.9;
    }
  }

  // 復帰位置の前後にある障害物を取り除く
  clearAround(z0, z1) {
    for (const item of this.items) {
      const z = item.mesh.position.z;
      if (item.active && z > z0 && z < z1) {
        item.active = false;
        item.mesh.visible = false;
      }
    }
  }

  // 道の両サイドのキワ（移動できる限界付近）に障害物を置く
  spawnEdge(z) {
    const cx = pathCenterX(z);
    const types = ['rock', 'stump', 'crate'];
    const sides = Math.random() < 0.35 ? [-1, 1] : [Math.random() < 0.5 ? -1 : 1];
    for (const side of sides) {
      const relX = side * THREE.MathUtils.randFloat(C.laneLimit - 1.6, C.laneLimit - 0.3);
      const type = types[Math.floor(Math.random() * types.length)];
      this.spawn(type, z + THREE.MathUtils.randFloat(-1.5, 1.5), cx + relX);
    }
  }

  spawnPattern(z) {
    const cx = pathCenterX(z);
    const pattern = Math.random();

    if (pattern < 0.45) {
      // 単体障害物
      const x = cx + THREE.MathUtils.randFloat(-C.laneLimit + 0.8, C.laneLimit - 0.8);
      this.spawn(Math.random() < 0.5 ? 'crate' : 'rock', z, x);
    } else if (pattern < 0.75) {
      // 左右に箱
      this.spawn('crate', z, cx - 2.5);
      this.spawn('crate', z, cx + 2.5);
    } else {
      // 岩場
      for (let i = 0; i < 3; i++) {
        const x = cx + THREE.MathUtils.randFloat(-C.laneLimit + 0.8, C.laneLimit - 0.8);
        this.spawn('rock', z + i * 1.5, x);
      }
    }
  }

  update(dt, player, onHit) {
    let markerIndex = 0;
    for (const item of this.items) {
      if (!item.active || !item.mesh.visible) continue;

      const dx = player.x - item.mesh.position.x;
      const dz = player.z - item.mesh.position.z;
      const distXZ = Math.hypot(dx, dz);

      // 目印を地面に表示
      const marker = this._marker(markerIndex++);
      marker.visible = true;
      marker.position.set(item.mesh.position.x, item.mesh.position.y - item.height * 0.5 + 0.03, item.mesh.position.z);
      const pulse = (Math.sin(performance.now() * 0.008) + 1) * 0.5;
      marker.scale.setScalar(1 + pulse * 0.15);
      marker.material.opacity = 0.6 + pulse * 0.3;

      if (distXZ < C.playerRadius + item.radius) {
        const pBottom = player.y - C.playerRadius;
        const pTop = player.y + C.playerRadius;
        const oBottom = item.mesh.position.y - item.height * 0.5;
        const oTop = item.mesh.position.y + item.height * 0.5;
        if (pTop > oBottom + 0.15 && pBottom < oTop) {
          // 横からか正面からかを判定
          const hitType = (Math.abs(dx) > Math.abs(dz) * 1.1) ? 'side' : 'front';
          onHit(item, hitType);
        }
      }

      if (item.mesh.position.z < player.z - C.despawnDistance) {
        item.active = false;
        item.mesh.visible = false;
      }
    }
    for (let i = markerIndex; i < this.markers.length; i++) {
      this.markers[i].visible = false;
    }
  }
}

// ------------------------------------------------------------
// 空と時間帯（昼 → 夕方 → 夜 → 朝 → 昼 …）
// ------------------------------------------------------------
const DAY_CYCLE_SECONDS = 180; // 1日の長さ（秒）
const TITLE_SECONDS = 7;       // タイトル画面を表示する時間
const DEMO_SECONDS = 20;       // デモプレイの長さ
const RANKING_API = 'api/ranking.php';
const SHOT_API = 'api/shot.php';
const PLAYER_NAME_KEY = 'kusamushiri.playerName';

// 前回入れた名前を覚えておく（保存できない環境でも動くように）
function loadPlayerName() {
  try { return localStorage.getItem(PLAYER_NAME_KEY) || ''; } catch (e) { return ''; }
}
function savePlayerName(name) {
  try { localStorage.setItem(PLAYER_NAME_KEY, name); } catch (e) { /* 保存できなくても続行 */ }
}

// ------------------------------------------------------------
// ブラウザ内ランキング（PHP が動かない GitHub Pages などで使う）
// ------------------------------------------------------------
const LOCAL_RANKING_KEY = 'kusamushiri.ranking';
const LOCAL_RANKING_LIMIT = 10;

// 草むしりスコア → 距離 → 先に登録した順（サーバー版と同じ並び）
function compareRanking(a, b) {
  return b.grass - a.grass || b.distance - a.distance || a.id - b.id;
}

function loadLocalRanking() {
  try {
    const rows = JSON.parse(localStorage.getItem(LOCAL_RANKING_KEY) || '[]');
    return Array.isArray(rows) ? rows.filter(r => r && typeof r.name === 'string') : [];
  } catch (e) {
    return [];
  }
}

// 容量オーバーなら古い記録の画像から順に外して保存し直す
function saveLocalRanking(rows) {
  const copy = rows.map(r => ({ ...r }));
  for (let i = copy.length; i >= 0; i--) {
    try {
      localStorage.setItem(LOCAL_RANKING_KEY, JSON.stringify(copy));
      return true;
    } catch (e) {
      const victim = copy.filter(r => r.shot).sort((a, b) => a.id - b.id)[0];
      if (!victim) return false;
      victim.shot = null;
    }
  }
  return false;
}

const MAX_MISSES = 2;          // この回数ミスしたらゲームオーバー
const MISS_SECONDS = 2.2;      // 転ぶ／もがく演出の長さ
const DEMO_MISS_SECONDS = 1.0; // デモ中にミスした時の演出の長さ
const COUNTDOWN_SECONDS = 3;   // スタート前のカウント

// 時間帯のキーフレーム（t: 0〜1 の1日の中の位置）
const SKY_KEYS = [
  { t: 0.00, top: '#2f86e0', horizon: '#a6d6f2', fog: '#a9cfdc', sun: '#fff2d6', sunI: 1.3,  hemi: '#e2f2ff', hemiI: 0.8,  cloud: '#ffffff', stars: 0,   elev: 0.75, fogNear: 30, fogFar: 165, beams: 1 },
  { t: 0.40, top: '#3a8ce0', horizon: '#b4dcf2', fog: '#b0d2dc', sun: '#fff0d0', sunI: 1.25, hemi: '#e2f2ff', hemiI: 0.8,  cloud: '#ffffff', stars: 0,   elev: 0.45, fogNear: 30, fogFar: 165, beams: 1 },
  { t: 0.52, top: '#5868a8', horizon: '#ff9c5c', fog: '#d09a78', sun: '#ffa060', sunI: 1.0,  hemi: '#ffd2b0', hemiI: 0.6,  cloud: '#ffc4a0', stars: 0,   elev: 0.12, fogNear: 28, fogFar: 155, beams: 0.6 },
  { t: 0.60, top: '#232a5c', horizon: '#c0587a', fog: '#5e4462', sun: '#ff7060', sunI: 0.45, hemi: '#8a78b0', hemiI: 0.42, cloud: '#b07a96', stars: 0.3, elev: 0.0,  fogNear: 24, fogFar: 140, beams: 0 },
  { t: 0.68, top: '#060b22', horizon: '#18234a', fog: '#182240', sun: '#a8bcff', sunI: 0.35, hemi: '#6a7cb8', hemiI: 0.48, cloud: '#3a4468', stars: 1,   elev: -0.3, fogNear: 20, fogFar: 125, beams: 0 },
  { t: 0.86, top: '#060b22', horizon: '#1a2650', fog: '#1a2444', sun: '#a8bcff', sunI: 0.35, hemi: '#6a7cb8', hemiI: 0.48, cloud: '#3a4468', stars: 1,   elev: -0.3, fogNear: 20, fogFar: 125, beams: 0 },
  { t: 0.94, top: '#4a6cb4', horizon: '#ffc292', fog: '#c8b0a4', sun: '#ffcc98', sunI: 0.8,  hemi: '#ffe2cc', hemiI: 0.6,  cloud: '#ffe0d0', stars: 0.1, elev: 0.1,  fogNear: 26, fogFar: 150, beams: 0.5 },
  { t: 1.00, top: '#2f86e0', horizon: '#a6d6f2', fog: '#a9cfdc', sun: '#fff2d6', sunI: 1.3,  hemi: '#e2f2ff', hemiI: 0.8,  cloud: '#ffffff', stars: 0,   elev: 0.75, fogNear: 30, fogFar: 165, beams: 1 },
];
const SKY_COLOR_KEYS = ['top', 'horizon', 'fog', 'sun', 'hemi', 'cloud'];
const SKY_NUM_KEYS = ['sunI', 'hemiI', 'stars', 'elev', 'fogNear', 'fogFar', 'beams'];
SKY_KEYS.forEach(k => SKY_COLOR_KEYS.forEach(n => { k[n] = new THREE.Color(k[n]); }));

class Sky {
  constructor(scene, hemi, sun) {
    this.scene = scene;
    this.hemi = hemi;
    this.sun = sun;
    this.state = {};
    SKY_COLOR_KEYS.forEach(n => { this.state[n] = new THREE.Color(); });

    // 空のドーム（グラデーション＋太陽＋月＋星をシェーダーで描く）
    this.uniforms = {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
      moonDir: { value: new THREE.Vector3(0, 1, 0) },
      stars: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        uniform vec3 moonDir;
        uniform float stars;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(horizonColor, topColor, pow(h, 0.55));
          // 太陽（円盤＋にじむ光）
          float s = max(dot(d, normalize(sunDir)), 0.0);
          float sunUp = smoothstep(-0.08, 0.05, sunDir.y);
          col += sunColor * (smoothstep(0.9993, 0.9996, s) * 1.2 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12) * sunUp;
          // 星
          vec3 cell = floor(d * 220.0);
          float st = step(0.9965, hash(cell)) * smoothstep(0.02, 0.25, d.y);
          col += vec3(st) * stars * (0.6 + 0.4 * hash(cell + 1.0));
          // 月
          float m = max(dot(d, normalize(moonDir)), 0.0);
          col += vec3(0.95, 0.97, 1.0) * (smoothstep(0.9990, 0.9993, m) + pow(m, 60.0) * 0.15) * stars;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    scene.add(this.dome);
    scene.background = null;
    scene.fog = new THREE.Fog(0xffffff, 30, 165);

    this.clouds = new Clouds(scene, 0);
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3(-0.35, 0.55, 1).normalize();
    this.daylight = 1;
  }

  // phase: 0〜1（1日の中の位置）
  _sample(phase) {
    let i = 0;
    while (i < SKY_KEYS.length - 2 && phase >= SKY_KEYS[i + 1].t) i++;
    const a = SKY_KEYS[i];
    const b = SKY_KEYS[i + 1];
    const f = THREE.MathUtils.smoothstep(phase, a.t, b.t);
    SKY_COLOR_KEYS.forEach(n => this.state[n].copy(a[n]).lerp(b[n], f));
    SKY_NUM_KEYS.forEach(n => { this.state[n] = THREE.MathUtils.lerp(a[n], b[n], f); });
    return this.state;
  }

  update(dt, timeSeconds, camera, player, speed) {
    const phase = ((timeSeconds / DAY_CYCLE_SECONDS) % 1 + 1) % 1;
    const s = this._sample(phase);

    // 太陽は進行方向（＋Z）の空を、昼は高く、夕方は地平線へ沈む
    const elev = s.elev;
    this.sunDir.set(0.35, elev, Math.max(0.2, 1 - Math.abs(elev) * 0.6)).normalize();

    this.uniforms.topColor.value.copy(s.top);
    this.uniforms.horizonColor.value.copy(s.horizon);
    this.uniforms.sunColor.value.copy(s.sun);
    this.uniforms.sunDir.value.copy(this.sunDir);
    this.uniforms.moonDir.value.copy(this.moonDir);
    this.uniforms.stars.value = s.stars;
    this.dome.position.copy(camera.position);

    this.scene.fog.color.copy(s.fog);
    this.scene.fog.near = s.fogNear;
    this.scene.fog.far = s.fogFar;

    this.hemi.color.copy(s.hemi);
    this.hemi.intensity = s.hemiI;

    // 平行光源：昼は太陽、夜は月の方向から。影が出るようプレイヤーに追従させる
    const lightDir = elev > 0.02 ? this.sunDir : this.moonDir;
    this.sun.color.copy(s.sun);
    this.sun.intensity = s.sunI;
    this.sun.position.set(player.x, player.y, player.z).addScaledVector(lightDir, 60);
    this.sun.target.position.set(player.x, player.y, player.z);
    this.sun.target.updateMatrixWorld();

    this.clouds.material.color.copy(s.cloud);
    this.clouds.material.opacity = THREE.MathUtils.lerp(0.35, 0.8, Math.min(1, s.hemiI / 0.8));
    this.clouds.update(dt, player.z, speed);

    this.daylight = s.beams;
  }
}

// ------------------------------------------------------------
// 雲（カメラに向く Sprite）
// ------------------------------------------------------------
class Clouds {
  constructor(scene, playerZ) {
    this.count = C.cloudCount;
    this.material = new THREE.SpriteMaterial({
      map: this._createTexture(),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      fog: false,
    });

    this.sprites = [];
    for (let i = 0; i < this.count; i++) {
      const sprite = new THREE.Sprite(this.material);
      sprite.renderOrder = 0;
      scene.add(sprite);
      const c = { sprite };
      this._place(c, playerZ + THREE.MathUtils.randFloat(-60, 260));
      this.sprites.push(c);
    }
  }

  _createTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const drawPuff = (x, y, r, alpha) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      g.addColorStop(0.55, `rgba(255, 255, 255, ${alpha * 0.6})`);
      g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    drawPuff(90, 72, 62, 0.95);
    drawPuff(150, 62, 56, 0.95);
    drawPuff(200, 76, 48, 0.85);
    drawPuff(58, 80, 42, 0.8);
    drawPuff(125, 88, 50, 0.85);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _place(c, z) {
    c.x = pathCenterX(z) + THREE.MathUtils.randFloat(-110, 110);
    c.y = THREE.MathUtils.randFloat(55, 95);
    c.z = z;
    c.drift = THREE.MathUtils.randFloat(0.5, 1.5);
    const scale = THREE.MathUtils.randFloat(1.5, 3.5);
    c.sprite.position.set(c.x, c.y, c.z);
    c.sprite.scale.set(scale * 14, scale * 7, 1);
  }

  update(dt, playerZ) {
    for (const c of this.sprites) {
      c.x += c.drift * dt;
      c.sprite.position.x = c.x;
      if (c.z < playerZ - 60) this._place(c, c.z + 320);
    }
  }

  reset(playerZ) {
    this.sprites.forEach(c => this._place(c, playerZ + THREE.MathUtils.randFloat(-60, 260)));
  }
}

// ------------------------------------------------------------
// デモプレイ用の自動操縦（Input と同じ形のオブジェクトを返す）
// 前方の障害物・落とし穴を見て、空いている横位置へ寄せ、よけきれない時はジャンプ
// ------------------------------------------------------------
class DemoPilot {
  constructor() {
    this.left = false;
    this.right = false;
    this.jumpPressed = false;
    this.target = 0;
  }

  reset() {
    this.left = this.right = this.jumpPressed = false;
    this.target = 0;
  }

  consumeJump() {
    this.jumpPressed = false;
  }

  think(game) {
    const p = game.player;
    const look = Math.max(20, game.speed * 1.8);
    const hazards = [];
    for (const it of game.obstacles.items) {
      if (!it.active) continue;
      const pos = it.mesh.position;
      const dz = pos.z - p.z;
      if (dz > -0.8 && dz < look) {
        hazards.push({ dz, near: dz - it.radius - C.playerRadius, rel: pos.x - pathCenterX(pos.z), r: it.radius + C.playerRadius + 0.45 });
      }
    }
    for (const pit of game.pitManager.pits) {
      const dz = pit.z - p.z;
      if (dz > -pit.radius && dz < look) {
        hazards.push({ dz, near: dz - pit.radius, rel: pit.relX, r: pit.radius + 0.45 });
      }
    }

    const cost = rel => {
      let c = Math.abs(rel - p.relX) * 0.12 + Math.abs(rel) * 0.05;
      for (const h of hazards) {
        if (Math.abs(rel - h.rel) < h.r) c += 2 + 10 * (1 - Math.max(0, h.dz) / look);
      }
      return c;
    };

    // 一番安全な横位置を探す（今の目標より明らかに良い時だけ乗り換える）
    let best = this.target;
    let bestCost = cost(this.target);
    for (let rel = -C.laneLimit + 0.5; rel <= C.laneLimit - 0.5; rel += 0.25) {
      const c = cost(rel);
      if (c < bestCost - 0.3) {
        best = rel;
        bestCost = c;
      }
    }
    this.target = best;

    this.left = this.target > p.relX + 0.25;  // left = 道中心からの相対Xを増やす
    this.right = this.target < p.relX - 0.25;

    // 目の前（手前のふちまでの距離）でよけきれない時はジャンプ
    const jumpWindow = game.speed * 0.18 + 0.6;
    const danger = hazards.some(h => h.near > -0.3 && h.near < jumpWindow && Math.abs(p.relX - h.rel) < h.r - 0.2);
    // デモではジャンプのストック切れで止まらないように補充しておく
    p.jumpStock = 3;
    if (danger && p.onGround) this.jumpPressed = true;
    return this;
  }
}

// ------------------------------------------------------------
// ゲーム本体
// ------------------------------------------------------------
class Game {
  constructor() {
    this.state = 'start'; // start(タイトル) | demo | playing | gameover
    this.totalTime = 0;
    this.speed = getTargetSpeed(0);
    this.score = 0;       // 距離
    this.grassScore = 0;  // 草むしりスコア
    this.spawnZ = 25;     // 最初の障害物を近めに
    this.edgeSpawnZ = 18; // キワの障害物
    this.lastRankLabel = RANKS[0].label;
    this.rankUpTimer = 0;
    this.clock = new THREE.Clock();

    this.input = new Input();
    this.demoPilot = new DemoPilot();
    this.titleTimer = 0;
    this.demoTimer = 0;
    this.demoCount = 0;

    // シーン
    this.scene = new THREE.Scene();

    // カメラ
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 450);
    this.camera.position.set(0, 5, -10);

    // レンダラー
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    this._setupLights();
    // 空・雲・時間帯（霧とライトの色もここで切り替える）
    this.dayTime = 0;
    this.sky = new Sky(this.scene, this.hemi, this.sunLight);

    // ゲームオブジェクト
    this.player = new Player(this.scene);
    this.ground = new Ground(this.scene);
    this.pitManager = new PitManager(this.scene);
    this.grass = new Grass(this.scene, 0);
    this.forest = new Forest(this.scene, 0);
    this.sunBeams = new SunBeams(this.scene, 0);
    this.speedLines = new SpeedLines(this.scene);
    this.obstacles = new Obstacles(this.scene);
    this.obstacles.avoid = (x, z) => this.pitManager.isNearPit(x, z, 1.2);
    this.grass.avoid = (x, z) => this.pitManager.isNearPit(x, z, 0.2);
    this.gateManager = new GateManager(this.scene);
    this.bursts = [];

    this._setupUI();
    this._onResize();
    window.addEventListener('resize', () => this._onResize());

    this.reset();
    this.loop();
  }

  _setupLights() {
    // 色と強さは Sky が時間帯に合わせて毎フレーム設定する
    this.hemi = new THREE.HemisphereLight(0xe2f2ff, 0x2f4a1f, 0.8);
    this.scene.add(this.hemi);

    const dir = new THREE.DirectionalLight(0xfff2d6, 1.3);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 140;
    dir.shadow.camera.left = -45;
    dir.shadow.camera.right = 45;
    dir.shadow.camera.top = 45;
    dir.shadow.camera.bottom = -45;
    this.scene.add(dir, dir.target);
    this.sunLight = dir;
  }

  _setupUI() {
    this.ui = {
      start: document.getElementById('start-screen'),
      hud: document.getElementById('hud'),
      gameover: document.getElementById('gameover-screen'),
      score: document.getElementById('score'),
      time: document.getElementById('time'),
      grassScore: document.getElementById('grass-score'),
      rank: document.getElementById('rank'),
      speed: document.getElementById('speed'),
      rankup: document.getElementById('rankup'),
      rankupText: document.getElementById('rankup-text'),
      finalRank: document.getElementById('final-rank'),
      finalScore: document.getElementById('final-score'),
      finalGrass: document.getElementById('final-grass'),
      startBtn: document.getElementById('start-btn'),
      restartBtn: document.getElementById('restart-btn'),
      jumpDots: [
        document.getElementById('jump-dot-0'),
        document.getElementById('jump-dot-1'),
        document.getElementById('jump-dot-2'),
      ],
      jumpBar: document.getElementById('jump-bar'),
      jumpGauge: document.getElementById('jump-gauge'),
    };

    this.ui.demoBanner = document.getElementById('demo-banner');
    this.ui.countdown = document.getElementById('countdown');
    this.ui.countdownNum = document.getElementById('countdown-num');
    this.ui.countdownSub = document.getElementById('countdown-sub');
    this.ui.lives = document.getElementById('lives');
    this.ui.nameEntry = document.getElementById('name-entry');
    this.ui.nameInput = document.getElementById('name-input');
    this.ui.nameSubmit = document.getElementById('name-submit');
    this.ui.entryMsg = document.getElementById('entry-msg');
    this.ui.rankingList = document.getElementById('ranking-list');
    this.ui.shareX = document.getElementById('share-x');
    this.ui.resultShot = document.getElementById('result-shot');
    this.ui.shotDownload = document.getElementById('shot-download');

    this.ui.nameEntry.addEventListener('submit', e => {
      e.preventDefault();
      this._submitRanking();
    });
    this.ui.shareX.addEventListener('click', () => this._shareToX());
    this.ui.startBtn.addEventListener('click', () => this.start());
    this.ui.restartBtn.addEventListener('click', () => this.reset());

    // デモ中は何か操作したらタイトルへ戻る／タイトルでは Enter で開始
    const onAnyInput = e => {
      // Esc で一時停止／再開
      if (e.code === 'Escape') {
        if (this.state === 'paused') this.resume();
        else this.pause();
        return;
      }
      if (this.state === 'demo') {
        e.preventDefault();
        this.reset();
      } else if (this.state === 'start' && e.code === 'Enter') {
        this.start();
      } else if (this.state === 'start') {
        this.titleTimer = 0; // 操作があればデモまでの待ち時間をリセット
      }
    };
    window.addEventListener('keydown', onAnyInput);
    window.addEventListener('pointerdown', onAnyInput);

    // 一時停止まわり
    this.ui.pauseBtn = document.getElementById('pause-btn');
    this.ui.pauseScreen = document.getElementById('pause-screen');
    this.ui.pauseBtn.addEventListener('click', () => this.pause());
    document.getElementById('resume-btn').addEventListener('click', () => this.resume());
    document.getElementById('retry-btn').addEventListener('click', () => {
      this.reset();
      this.start();
    });
    document.getElementById('to-title-btn').addEventListener('click', () => this.reset());
    // 別のタブやアプリに切り替えたら自動で止める
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });

    this.ui.rankingTitle = document.getElementById('ranking-title');
    this.ui.nameLabel = document.getElementById('name-label');
    this.ui.shotViewer = document.getElementById('shot-viewer');
    this.ui.shotViewerImg = document.getElementById('shot-viewer-img');
    this.ui.shotViewer.addEventListener('click', () => this.ui.shotViewer.classList.add('hidden'));
    this._rankingMode();

    this.ui.shotCopy = document.getElementById('shot-copy');
    this.ui.shotMsg = document.getElementById('shot-msg');
    this.ui.shotCopy.addEventListener('click', () => this._copyShot());
  }

  // プレイ中（カウントダウン・ミス演出を含む）だけ止められる
  pause() {
    if (!['playing', 'countdown', 'miss'].includes(this.state)) return;
    this.pausedState = this.state;
    this.state = 'paused';
    this.input.left = this.input.right = false;
    this.input.consumeJump();
    this.ui.pauseScreen.classList.remove('hidden');
    this.ui.pauseBtn.classList.add('hidden');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.pausedState;
    this.ui.pauseScreen.classList.add('hidden');
    this.ui.pauseBtn.classList.remove('hidden');
    this.clock.getDelta(); // 止めていた時間を経過時間に含めない
  }

  // 画像をクリップボードへ（クリップボードは PNG のみ対応のブラウザが多いので PNG に変換）
  async _copyShot() {
    const r = this.result;
    if (!r || !r.shotCanvas) return;
    const msg = this.ui.shotMsg;
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      msg.textContent = 'このブラウザでは画像のコピーができません。「画像を保存」を使ってください';
      return;
    }
    try {
      // Safari はクリック直後に ClipboardItem を作る必要があるため Promise のまま渡す
      const blob = new Promise((resolve, reject) => {
        r.shotCanvas.toBlob(b => (b ? resolve(b) : reject(new Error('blob'))), 'image/png');
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      msg.textContent = 'コピーしました！Xの投稿画面に貼り付けできます';
    } catch (err) {
      msg.textContent = 'コピーできませんでした。「画像を保存」を使ってください';
    }
  }

  start() {
    if (this.state === 'demo') this.reset();
    this.ui.start.classList.add('hidden');
    this.ui.gameover.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    this.ui.jumpGauge.classList.remove('hidden');
    this.clock.start();
    this.ui.pauseBtn.classList.remove('hidden');
    this._startCountdown('');
    this._beginPlaySession();
  }

  // ランキング登録用のトークンをサーバーから受け取る（記録の妥当性チェックに使う）
  // ランキングの保存先を決める：PHP の API が答えればサーバー、だめならこのブラウザ
  _rankingMode() {
    if (!this.rankingModePromise) {
      this.rankingModePromise = (async () => {
        try {
          const res = await fetch(RANKING_API, { cache: 'no-store' });
          const data = await res.json();
          return data && data.ok ? 'server' : 'local';
        } catch (err) {
          return 'local';
        }
      })().then(mode => {
        this._applyRankingMode(mode);
        return mode;
      });
    }
    return this.rankingModePromise;
  }

  _applyRankingMode(mode) {
    const local = mode === 'local';
    this.ui.rankingTitle.textContent = local ? 'このブラウザのランキング' : 'ランキング';
    this.ui.nameLabel.textContent = local
      ? 'なまえを入れて この画面と一緒に このブラウザに記録しよう'
      : 'なまえを入れて この画面と一緒に ランキングに登録しよう';
  }

  async _beginPlaySession() {
    this.playToken = null;
    if (await this._rankingMode() === 'local') return;
    try {
      const res = await fetch(RANKING_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const data = await res.json();
      if (data.ok) this.playToken = data.token;
    } catch (err) {
      // 通信できなくても遊べるようにする（登録だけできない）
    }
  }

  // 3・2・1・スタート！
  _startCountdown(subText) {
    this.state = 'countdown';
    this.countdownTimer = 0;
    this.countdownShown = null;
    this.ui.countdownSub.textContent = subText;
    this.ui.countdown.classList.remove('hidden');
  }

  _updateCountdown(dt) {
    this.countdownTimer += dt;
    const left = COUNTDOWN_SECONDS - this.countdownTimer;
    const label = left > 0 ? String(Math.ceil(left)) : 'スタート！';
    if (label !== this.countdownShown) {
      this.countdownShown = label;
      const el = this.ui.countdownNum;
      el.textContent = label;
      el.classList.toggle('go', left <= 0);
      // ポップのアニメーションをかけ直す
      el.style.animation = 'none';
      void el.offsetHeight;
      el.style.animation = '';
    }
    if (left <= 0 && this.state === 'countdown') {
      this.state = 'playing';
      this.input.consumeJump();
    }
  }

  _updateLives() {
    const left = Math.max(0, MAX_MISSES - this.misses);
    this.ui.lives.textContent = '♥'.repeat(left) + '♡'.repeat(MAX_MISSES - left);
  }

  // タイトルを一定時間放置すると始まるデモプレイ
  // restart=true はデモ中のミスからのやり直し（デモの残り時間と時間帯は引き継ぐ）
  startDemo(restart = false) {
    const keepTimer = this.demoTimer;
    const keepDay = this.dayTime;
    this.reset();
    this.state = 'demo';
    this.demoPilot.reset();
    // 少し進んだ段位から始めて、昇級ゲートや夕焼けも見せる
    this.totalTime = 28;
    this.speed = getTargetSpeed(this.totalTime);
    if (restart) {
      this.demoTimer = keepTimer;
      this.dayTime = keepDay;
    } else {
      this.demoTimer = 0;
      this.dayTime = this.demoCount % 2 === 0 ? 0 : DAY_CYCLE_SECONDS * 0.47;
      this.demoCount++;
    }
    this.ui.start.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    this.ui.jumpGauge.classList.remove('hidden');
    this.ui.demoBanner.classList.remove('hidden');
  }

  // 障害物にぶつかった／穴に落ちた
  // 障害物に正面からぶつかった（kind='tumble'）／穴に落ちた（kind='pit'）
  _playerDown(kind, pit = null) {
    if (this.player.state === 'tumble' || this.player.state === 'pit') return;
    if (kind === 'pit') {
      const px = pathCenterX(pit.z) + pit.relX;
      this.player.pitFall(px, pit.z, terrainHeight(px, pit.z));
    } else {
      this.player.tumble(this.speed);
    }
    this.missPit = pit;
    this.missFrom = this.state; // playing | demo
    this.missTimer = 0;
    this.state = 'miss';
    if (this.missFrom === 'playing') {
      this.misses++;
      this._updateLives();
    }
  }

  // 転ぶ／もがく演出のあと、ゲームオーバーか復帰か
  _updateMiss(dt) {
    this.missTimer += dt;
    this.player.update(dt, this.demoPilot, 0, terrainHeight(this.player.x, this.player.z));
    this.speed = THREE.MathUtils.lerp(this.speed, 0, dt * 3);
    // デモ中のミスは転ぶ様子を一瞬だけ見せて、すぐにやり直す
    if (this.missTimer < (this.missFrom === 'demo' ? DEMO_MISS_SECONDS : MISS_SECONDS)) return;

    if (this.missFrom === 'demo') {
      this.startDemo(true);
    } else if (this.misses >= MAX_MISSES) {
      this.speed = 0;
      this.gameOver();
    } else {
      // その場（穴なら穴の先）から走り直す。周りの障害物と穴は片付ける
      const z = this.missPit ? this.missPit.z + this.missPit.radius + 1.5 : this.player.z;
      this.obstacles.clearAround(z - 4, z + 35);
      this.pitManager.clearAround(z - 4, z + 35);
      this.ground.lastStartZ = null;
      this.player.respawn(z, 0);
      this.speed = getTargetSpeed(this.totalTime);
      this.spawnZ = Math.max(this.spawnZ, z + 35);
      this.edgeSpawnZ = Math.max(this.edgeSpawnZ, z + 35);
      this._startCountdown(`のこり ${MAX_MISSES - this.misses} かい`);
    }
  }

  gameOver() {
    this.state = 'gameover';
    const rank = RANKS[getRankByTime(this.totalTime)];
    this.ui.finalRank.textContent = rank.label;
    this.ui.finalRank.style.color = rank.color;
    this.ui.finalScore.textContent = Math.floor(this.score);
    this.ui.finalGrass.textContent = this.grassScore;
    this.ui.hud.classList.add('hidden');
    this.ui.jumpGauge.classList.add('hidden');
    this.ui.pauseBtn.classList.add('hidden');
    this.ui.gameover.classList.remove('hidden');

    // 今回の記録（ランキング登録・Xへのポストで使う）
    this.result = {
      distance: Math.floor(this.score),
      grass: this.grassScore,
      rank: rank.label,
      position: null,
      id: null,
      shot: null,
    };
    // この直後の描画で画面をキャプチャする（WebGL の描画直後でないと読み取れないため）
    this.captureRequested = true;
    this.ui.resultShot.removeAttribute('src');
    this.ui.shotDownload.classList.add('hidden');
    this.ui.shotCopy.classList.add('hidden');
    this.ui.shotMsg.textContent = '';
    this.ui.nameEntry.classList.remove('hidden');
    this.ui.nameSubmit.disabled = false;
    this.ui.entryMsg.textContent = '';
    this.ui.nameInput.value = loadPlayerName();
    this._loadRanking();
  }

  async _loadRanking() {
    this.ui.rankingList.innerHTML = '<li class="ranking-empty">よみこみ中…</li>';
    if (await this._rankingMode() === 'local') {
      this._renderRanking(this._localRows(loadLocalRanking()));
      return;
    }
    try {
      const res = await fetch(RANKING_API, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      this._renderRanking(data.ranking);
    } catch (err) {
      this.ui.rankingList.innerHTML = '<li class="ranking-empty">ランキングに接続できませんでした</li>';
    }
  }

  async _submitRanking() {
    const name = this.ui.nameInput.value.trim();
    if (!name || !this.result || this.result.id) return;
    if (await this._rankingMode() === 'local') {
      this._submitLocalRanking(name);
      return;
    }
    if (!this.playToken) {
      this.ui.entryMsg.textContent = 'サーバーに接続できなかったため、このプレイは登録できません';
      return;
    }
    this.ui.nameSubmit.disabled = true;
    this.ui.entryMsg.textContent = '登録中…';
    try {
      const res = await fetch(RANKING_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.playToken,
          name,
          distance: this.result.distance,
          grass: this.result.grass,
          rank: this.result.rank,
          shot: this.result.shot,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '登録できませんでした');
      savePlayerName(name);
      this.playToken = null; // トークンは1回きり
      this.result.id = data.id;
      this.result.position = data.position;
      this.ui.nameEntry.classList.add('hidden');
      this.ui.entryMsg.textContent = `${data.position}位で登録しました！`;
      this._renderRanking(data.ranking);
    } catch (err) {
      this.ui.nameSubmit.disabled = false;
      this.ui.entryMsg.textContent = err.message || '登録できませんでした';
    }
  }

  // このブラウザに記録する（上位10件だけ残す）
  _submitLocalRanking(name) {
    const r = this.result;
    const entry = {
      id: Date.now(),
      name: name.slice(0, 10),
      distance: r.distance,
      grass: r.grass,
      rank: r.rank,
      created_at: new Date().toISOString(),
      shot: r.shot,
    };
    const all = [...loadLocalRanking(), entry].sort(compareRanking);
    const position = all.indexOf(entry) + 1;
    const kept = all.slice(0, LOCAL_RANKING_LIMIT);
    savePlayerName(name);
    r.id = entry.id;
    r.position = position;
    this.ui.nameEntry.classList.add('hidden');

    if (position > LOCAL_RANKING_LIMIT) {
      this.ui.entryMsg.textContent = `${position}位でした。10位以内でランキングに残ります！`;
    } else if (saveLocalRanking(kept)) {
      this.ui.entryMsg.textContent = `${position}位で このブラウザに記録しました！`;
    } else {
      this.ui.entryMsg.textContent = 'ブラウザに保存できませんでした（プライベートモードなど）';
    }
    this._renderRanking(this._localRows(kept));
  }

  _localRows(rows) {
    return rows.sort(compareRanking).map((row, i) => ({ ...row, position: i + 1, shotUrl: row.shot || null }));
  }

  // 名前は利用者の入力なので、必ず textContent で表示する
  _renderRanking(rows) {
    const list = this.ui.rankingList;
    list.textContent = '';
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'ranking-empty';
      li.textContent = 'まだ記録がありません。一番乗りしよう！';
      list.appendChild(li);
      return;
    }
    for (const row of rows) {
      const li = document.createElement('li');
      if (this.result && row.id === this.result.id) li.classList.add('me');
      const pos = document.createElement('span');
      pos.className = 'pos';
      pos.textContent = `${row.position}`;
      li.appendChild(pos);

      // 登録時の画面キャプチャ（クリックで大きく表示）
      const shotUrl = row.shotUrl !== undefined ? row.shotUrl : (row.has_shot ? `${SHOT_API}?id=${row.id}` : null);
      const safeUrl = shotUrl && (shotUrl.startsWith('data:image/jpeg;base64,') || shotUrl.startsWith(SHOT_API)) ? shotUrl : null;
      const thumb = document.createElement(safeUrl ? 'button' : 'span');
      thumb.className = 'thumb';
      if (safeUrl) {
        const url = safeUrl;
        thumb.type = 'button';
        thumb.setAttribute('aria-label', `${row.name} の画面を大きく見る`);
        thumb.addEventListener('click', () => this._openShotViewer(url));
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        thumb.appendChild(img);
      }
      li.appendChild(thumb);

      const cells = [
        ['name', row.name],
        ['grass', `🌱${row.grass}`],
        ['dist', `${row.distance} m`],
        ['rank', row.rank],
      ];
      for (const [cls, text] of cells) {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        li.appendChild(span);
      }
      list.appendChild(li);
    }
  }

  _openShotViewer(url) {
    this.ui.shotViewerImg.src = url;
    this.ui.shotViewer.classList.remove('hidden');
  }

  _shareToX() {
    const r = this.result;
    if (!r) return;
    const pos = r.position ? `ランキング${r.position}位！` : '';
    const text = `🌱草むしり検定実技🌱\n草むしりスコア ${r.grass}！ ${pos}\n検定結果「${r.rank}」／走行距離 ${r.distance}m\n#草むしり検定`;
    const url = location.origin + location.pathname;
    const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(intent, '_blank', 'noopener,noreferrer');
  }

  _updateJumpGauge() {
    if (!this.ui.jumpDots) return;
    this.ui.jumpDots.forEach((dot, i) => {
      dot.classList.toggle('active', i < this.player.jumpStock);
    });
    const ratio = Math.min(1, this.player.jumpCharge / this.player.jumpChargeInterval);
    this.ui.jumpBar.style.width = `${ratio * 100}%`;
  }

  _getNextRankBorder() {
    let t = 0;
    for (let i = 1; i < RANKS.length; i++) {
      t += RANKS[i - 1].duration;
      if (this.totalTime < t) {
        return { time: t, rank: RANKS[i] };
      }
    }
    return null;
  }

  _showRankUp(label) {
    this.ui.rankupText.textContent = `${label}に昇級！`;
    const el = this.ui.rankup;
    el.classList.remove('hidden');
    // アニメーションをリスタート
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
    this.rankUpTimer = 4.0;
  }

  reset() {
    this.state = 'start';
    this.titleTimer = 0;
    this.misses = 0;
    this.totalTime = 0;
    this.speed = getTargetSpeed(0);
    this.score = 0;
    this.grassScore = 0;
    this.spawnZ = 25;
    this.edgeSpawnZ = 18;
    this.lastRankLabel = RANKS[0].label;
    this.rankUpTimer = 0;

    this.player.reset();
    this.ground.lastStartZ = null;
    this.ground.update(0, []);
    this.pitManager.reset();
    this.grass.reset(0);
    this.forest.reset(0);
    this.sunBeams.reset(0);
    this.sky.clouds.reset(0);
    this.dayTime = 0;
    this.gateManager.clear();

    this.obstacles.items.forEach(i => {
      i.active = false;
      i.mesh.visible = false;
    });
    this.obstacles.markers.forEach(m => { m.visible = false; });
    this.bursts.forEach(b => b.dispose());
    this.bursts = [];

    this.ui.start.classList.remove('hidden');
    this.ui.gameover.classList.add('hidden');
    this.ui.hud.classList.add('hidden');
    this.ui.rankup.classList.add('hidden');
    this.ui.jumpGauge.classList.add('hidden');
    this.ui.demoBanner.classList.add('hidden');
    this.ui.countdown.classList.add('hidden');
    this.ui.pauseScreen.classList.add('hidden');
    this.ui.pauseBtn.classList.add('hidden');
    this._updateLives();
    this.ui.score.textContent = '0';
    this.ui.time.textContent = formatTime(0);
    this.ui.grassScore.textContent = '0';
    this.ui.rank.textContent = RANKS[0].label;
    this.ui.rank.style.color = RANKS[0].color;
    this.ui.speed.textContent = '0';
    this._updateJumpGauge();
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  update(dt) {
    if (this.state === 'countdown') {
      this._updateCountdown(dt);
      this._updateCamera(dt);
      return;
    }
    if (this.state === 'miss') {
      this._updateMiss(dt);
      if (this.state !== 'miss') return;
      this.ground.update(this.player.z, this.pitManager.pits);
      this._updateCamera(dt);
      return;
    }
    if (this.state !== 'playing' && this.state !== 'demo') return;
    const input = this.state === 'demo' ? this.demoPilot.think(this) : this.input;

    this.totalTime += dt;
    const targetSpeed = getTargetSpeed(this.totalTime);
    this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, dt * 2);
    this.score = this.player.z;

    // 落とし穴更新
    this.pitManager.update(this.player.z);

    const groundY = this.pitManager.getGroundHeight(this.player.x, this.player.z);
    this.player.update(dt, input, this.speed, groundY);

    this.ground.update(this.player.z, this.pitManager.pits);
    this.grass.update(this.player, d => {
      this.grassScore += d.score;
    });
    this.forest.update(this.player.z);
    this.sunBeams.update(this.player.z);
    this.speedLines.update(dt, this.player.z, this.speed);
    this.gateManager.update(dt, this.player.z);

    // 障害物を先に生成（速度に応じた距離間隔）
    const spawnDistance = Math.max(120, this.speed * 3);
    while (this.player.z + spawnDistance > this.spawnZ) {
      this.obstacles.spawnPattern(this.spawnZ);
      this.spawnZ += getObstacleInterval(this.speed);
    }
    // 両サイドのキワにも障害物（メインの約半分の間隔）
    while (this.player.z + spawnDistance > this.edgeSpawnZ) {
      this.obstacles.spawnEdge(this.edgeSpawnZ);
      this.edgeSpawnZ += getObstacleInterval(this.speed) * 0.5;
    }

    this.obstacles.update(dt, this.player, (item, hitType) => {
      if (this.player.state !== 'running' || this.player.invincible > 0) return;
      if (hitType === 'front') {
        this._playerDown('tumble');
      } else {
        this.player.bounceFrom(item.mesh.position.x);
        this.grassScore += 20;
        this.bursts.push(new GrassBurst(
          this.scene,
          item.mesh.position.x,
          item.mesh.position.y,
          item.mesh.position.z
        ));
      }
    });

    // 草飛び散りエフェクト更新
    this.bursts = this.bursts.filter(b => {
      const alive = b.update(dt);
      if (!alive) b.dispose();
      return alive;
    });

    // 落とし穴落下
    const pit = this.player.invincible > 0 ? null : this.pitManager.pitUnder(this.player);
    if (pit && this.state !== 'miss') {
      this._playerDown('pit', pit);
    }

    // 昇級ゲート出現
    const border = this._getNextRankBorder();
    if (border && !this.gateManager.gate && border.time - this.totalTime < 2.5 && this.totalTime < border.time) {
      this.gateManager.spawn(this.player.z + 55, border.rank);
    }

    this._updateCamera(dt);

    // UI更新
    this.ui.score.textContent = Math.floor(this.score);
    this.ui.time.textContent = formatTime(this.totalTime);
    this.ui.grassScore.textContent = this.grassScore;
    this.ui.speed.textContent = Math.floor(this.speed * 3.6);
    this._updateJumpGauge();

    const rank = RANKS[getRankByTime(this.totalTime)];
    if (this.ui.rank.textContent !== rank.label) {
      this.ui.rank.textContent = rank.label;
      this.ui.rank.style.color = rank.color;
    }

    // 昇級通知
    if (rank.label !== this.lastRankLabel) {
      this._showRankUp(rank.label);
      this.lastRankLabel = rank.label;
    }
    if (this.rankUpTimer > 0) {
      this.rankUpTimer -= dt;
      if (this.rankUpTimer <= 0) {
        this.ui.rankup.classList.add('hidden');
      }
    }
  }

  // カメラ追従＋加速エフェクト（FOV / 距離）。snap=true で補間せず即座に合わせる
  _updateCamera(dt, snap = false) {
    const sr = speedRatio(this.speed);
    const targetFov = THREE.MathUtils.lerp(60, 73, sr);
    this.camera.fov = snap ? targetFov : THREE.MathUtils.lerp(this.camera.fov, targetFov, dt * 2);
    this.camera.updateProjectionMatrix();

    // カメラは蛇行する道の中心線に沿って追従させる（森の木に埋もれないように）
    const camDistance = 9 + this.speed * 0.08 + sr * 3;
    const camZ = this.player.z - camDistance;
    const targetPos = new THREE.Vector3(
      pathCenterX(camZ) + this.player.relX * 0.4,
      this.player.y + 3.8 + this.speed * 0.05 + sr * 0.75,
      camZ
    );
    if (snap) this.camera.position.copy(targetPos);
    else this.camera.position.lerp(targetPos, dt * 4);

    const lookAheadZ = this.player.z + 10 + this.speed * 0.15 + sr * 5;
    const lookAt = new THREE.Vector3(
      THREE.MathUtils.lerp(this.player.x, pathCenterX(lookAheadZ) + this.player.relX * 0.3, 0.5),
      this.player.y + 1.2,
      lookAheadZ
    );
    this.camera.lookAt(lookAt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    if (this.captureRequested) {
      this.captureRequested = false;
      this._captureResult();
    }
  }

  // ゲームオーバーの瞬間の画面に、結果の帯を重ねた JPEG を作る
  _captureResult() {
    const src = this.renderer.domElement;
    const w = 640;
    const h = Math.round(w * Math.min(src.height / src.width, 0.75));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // 縦長の画面では中央を切り出す
    const srcH = Math.min(src.height, src.width * (h / w));
    ctx.drawImage(src, 0, (src.height - srcH) / 2, src.width, srcH, 0, 0, w, h);

    // 下に結果の帯
    const r = this.result;
    const bandH = 54;
    ctx.fillStyle = 'rgba(255, 250, 240, 0.92)';
    ctx.fillRect(0, h - bandH, w, bandH);
    ctx.fillStyle = '#5b4636';
    ctx.fillRect(0, h - bandH, w, 3);
    const font = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.font = `900 22px ${font}`;
    ctx.fillText(`🌱 草むしりスコア ${r.grass}`, 16, h - bandH / 2);
    ctx.font = `700 16px ${font}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${r.rank}　${r.distance} m　草むしり検定実技`, w - 16, h - bandH / 2);

    r.shotCanvas = canvas;
    r.shot = canvas.toDataURL('image/jpeg', 0.82);
    this.ui.resultShot.src = r.shot;
    this.ui.shotDownload.href = r.shot;
    this.ui.shotDownload.classList.remove('hidden');
    this.ui.shotCopy.classList.remove('hidden');
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.update(dt);
    if (this.state === 'playing' || this.state === 'demo') this.dayTime += dt;

    // タイトル7秒 → デモ20秒 → タイトル … を繰り返す
    if (this.state === 'start') {
      this.titleTimer += dt;
      if (this.titleTimer >= TITLE_SECONDS) this.startDemo();
    } else if (this.state === 'demo') {
      this.demoTimer += dt;
      if (this.demoTimer >= DEMO_SECONDS) this.reset();
    }
    if (this.state === 'start') this._updateCamera(dt, true);

    // 「スタート！」を少しだけ見せてから消す
    if (this.state !== 'countdown' && this.state !== 'paused' && !this.ui.countdown.classList.contains('hidden')) {
      this.countdownTimer += dt;
      if (this.countdownTimer > COUNTDOWN_SECONDS + 0.8) this.ui.countdown.classList.add('hidden');
    }
    this.sky.update(dt, this.dayTime, this.camera, this.player, this.speed);
    this.sunBeams.material.opacity = 0.16 * this.sky.daylight;
    this.render();
  }
}

new Game();
