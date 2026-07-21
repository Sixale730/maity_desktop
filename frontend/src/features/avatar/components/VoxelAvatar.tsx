/**
 * VoxelAvatar Component
 *
 * Renders a Crossy Road-style voxel avatar using React Three Fiber.
 * Optimized lighting for that bright, cheerful cartoon look.
 */

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { VoxelCharacter } from './voxel-parts';
import type { AvatarConfiguration, AvatarSize, AVATAR_SIZE_CONFIG, ItemCode } from '@maity/shared';

interface VoxelAvatarProps {
  config: Partial<AvatarConfiguration>;
  size?: AvatarSize;
  enableRotation?: boolean;
  autoRotate?: boolean;
  enableZoom?: boolean;
  className?: string;
  showPedestal?: boolean;
  animate?: boolean;
}

// Camera positions for balanced Crossy Road proportions
const SIZE_CONFIG: typeof AVATAR_SIZE_CONFIG = {
  xs: { width: 32, height: 32, cameraZ: 3.5 },
  sm: { width: 48, height: 48, cameraZ: 3.2 },
  md: { width: 80, height: 80, cameraZ: 2.8 },
  lg: { width: 150, height: 150, cameraZ: 2.5 },
  xl: { width: 300, height: 300, cameraZ: 2.2 },
};

export function VoxelAvatar({
  config,
  size = 'md',
  enableRotation = false,
  autoRotate = false,
  enableZoom = false,
  className = '',
  showPedestal = false,
  animate = false,
}: VoxelAvatarProps) {
  const sizeConfig = SIZE_CONFIG[size];

  return (
    <div
      className={`relative ${className}`}
      style={{ width: sizeConfig.width, height: sizeConfig.height }}
    >
      <Canvas
        camera={{
          position: [0, 0.4, sizeConfig.cameraZ],
          fov: 45,
          near: 0.1,
          far: 100,
        }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        style={{ background: 'transparent' }}
        shadows
      >
        <Suspense fallback={null}>
          {/*
            CROSSY ROAD STYLE LIGHTING
            - High ambient for cheerful flat look
            - Soft directional for subtle depth
            - No harsh shadows
          */}

          {/* High ambient light - Crossy Road is bright! */}
          <ambientLight intensity={0.85} />

          {/* Main light - from front-top-right */}
          <directionalLight
            position={[3, 4, 5]}
            intensity={0.7}
            castShadow
            shadow-mapSize={[512, 512]}
            shadow-camera-far={20}
            shadow-camera-near={0.1}
            shadow-camera-left={-5}
            shadow-camera-right={5}
            shadow-camera-top={5}
            shadow-camera-bottom={-5}
          />

          {/* Fill light - from left side */}
          <directionalLight
            position={[-3, 2, 3]}
            intensity={0.4}
          />

          {/* Rim light - from behind for that cartoon pop */}
          <directionalLight
            position={[0, 2, -4]}
            intensity={0.3}
          />

          {/* Subtle bottom fill to lighten shadows */}
          <directionalLight
            position={[0, -2, 2]}
            intensity={0.15}
          />

          {/* Character */}
          <VoxelCharacter
            characterPreset={config.character_preset || 'human'}
            outfitPreset={config.outfit_preset}
            headType={config.head_type || 'default'}
            bodyType={config.body_type || 'default'}
            skinColor={config.skin_color || '#FFD7C4'}
            hairColor={config.hair_color || '#3D2314'}
            shirtColor={config.shirt_color || '#4A90D9'}
            pantsColor={config.pants_color || '#3D3D3D'}
            accessories={config.accessories || []}
            items={(config.items || []) as ItemCode[]}
            animate={animate}
          />

          {/* Optional pedestal */}
          {showPedestal && <Pedestal />}

          {/* Controls */}
          {(enableRotation || autoRotate) && (
            <OrbitControls
              enableZoom={enableZoom}
              enablePan={false}
              autoRotate={autoRotate}
              autoRotateSpeed={1.5}
              minPolarAngle={Math.PI / 3}
              maxPolarAngle={Math.PI / 1.8}
              enableRotate={enableRotation}
              target={[0, 0.4, 0]}
            />
          )}
        </Suspense>
      </Canvas>
    </div>
  );
}

function Pedestal() {
  return (
    <mesh position={[0, -0.75, 0]} receiveShadow>
      <cylinderGeometry args={[0.7, 0.85, 0.12, 32]} />
      <meshStandardMaterial
        color="#2A2A3E"
        metalness={0.2}
        roughness={0.8}
      />
    </mesh>
  );
}

export default VoxelAvatar;
