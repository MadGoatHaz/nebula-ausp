/**
 * @author mrdoob / http://mrdoob.com/
 * @author rouser / http://rouser.github.io/
 */

import {
	AdditiveBlending,
	Color,
	ShaderMaterial,
	UniformsUtils
} from 'three';
import { ConvolutionShader } from './ConvolutionShader.js';

const GodRaysShader = {

	uniforms: {

		tDiffuse: { value: null },
		fX: { value: 0.5 },
		fY: { value: 0.5 },
		fExposure: { value: 0.6 },
		fDecay: { value: 0.95 },
		fDensity: { value: 0.96 },
		fWeight: { value: 0.4 },
		fClamp: { value: 1.0 },

	},

	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,

	fragmentShader: /* glsl */`
		#define TAPS_PER_PASS 6.0
		varying vec2 vUv;
		uniform sampler2D tDiffuse;
		uniform float fX;
		uniform float fY;
		uniform float fExposure;
		uniform float fDecay;
		uniform float fDensity;
		uniform float fWeight;
		uniform float fClamp;
		void main() {
			vec2 vUv2 = vUv;
			vec2 vDelta = vec2( vUv2.x - fX, vUv2.y - fY );
			float fDist = length( vDelta );
			vec2 vStep = vDelta / TAPS_PER_PASS;
			float fIllum = texture2D( tDiffuse, vUv2 ).x;
			float fCurDecay = 1.0;
			for( float i = 0.0; i < TAPS_PER_PASS; i++ ) {
				vUv2 -= vStep;
				fIllum += texture2D( tDiffuse, vUv2 ).x * fCurDecay;
				fCurDecay *= fDecay;
			}
			gl_FragColor = vec4( fIllum * fExposure, fIllum * fExposure, fIllum * fExposure, 1.0 );
			gl_FragColor *= fDensity;
			gl_FragColor = clamp( gl_FragColor, 0.0, fClamp );
		}`
};

class GodRaysMaterial extends ShaderMaterial {

	constructor() {

		super( {
			uniforms: UniformsUtils.clone( GodRaysShader.uniforms ),
			vertexShader: GodRaysShader.vertexShader,
			fragmentShader: GodRaysShader.fragmentShader,
			blending: AdditiveBlending,
			depthTest: false,
			depthWrite: false,
			transparent: true
		} );
	}
}

const GodRaysCombineShader = {

	uniforms: {
		tColors: { value: null },
		tGodRays: { value: null },
		fCoeff: { value: 1.0 }
	},

	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,

	fragmentShader: /* glsl */`
		varying vec2 vUv;
		uniform sampler2D tColors;
		uniform sampler2D tGodRays;
		void main() {
			gl_FragColor = texture2D( tColors, vUv ) + texture2D( tGodRays, vUv );
		}`
};


const GodRaysGenerateShader = {

	uniforms: {
		tDiffuse: { value: null },
		fGodRayIntensity: { value: 0.69 },
		vSunPositionScreenSpace: { value: new Color( 0.5, 0.5, 0.0 ) }
	},

	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,

	fragmentShader: /* glsl */`
		varying vec2 vUv;
		uniform sampler2D tDiffuse;
		void main() {
			gl_FragColor = vec4( 1.0 - texture2D( tDiffuse, vUv ).w, 0.0, 0.0, 1.0 );
		}`
};


/**
 * The god-ray algorithm uses 5 shader passes to create the effect.
 *
 * The first pass renders the scene solid black, with the exception of the sky which is rendered using the sky's color.
 * The second pass blurs the result of the first pass vertically.
 * The third pass blurs the result of the first pass horizontally.
 * The fourth pass adds the blurred sky to the original scene.
 * The fifth pass renders the god-rays using the same technique as the first pass, but on a smaller texture, and with the sky now being rendered black, and the sun being rendered in white. The result of this pass is then blurred vertically and horizontally, and then added to the original scene.
 *
 * @param {object}
 */

const GodRaysFakeSunShader = {

	uniforms: {
		vSunPositionScreenSpace: { value: new Color( 0.5, 0.5, 0.0 ) },
		fAspect: { value: 1.0 },
		fSunIntensity: { value: 1.0 }
	},

	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,

	fragmentShader: /* glsl */`
		varying vec2 vUv;
		uniform vec3 vSunPositionScreenSpace;
		uniform float fAspect;
		uniform float fSunIntensity;
		void main() {
			vec2 vUv2 = vUv;
			vUv2.x *= fAspect;
			float fSunDist = length( vUv2 - vSunPositionScreenSpace.xy );
			float fSun = smoothstep( 0.25, 0.0, fSunDist );
			fSun *= fSunIntensity;
			gl_FragColor = vec4( vSunPositionScreenSpace.z * fSun, vSunPositionScreenSpace.z * fSun, vSunPositionScreenSpace.z * fSun, 1.0 );
		}`
};

export { GodRaysShader, GodRaysMaterial, GodRaysCombineShader, GodRaysGenerateShader, GodRaysFakeSunShader }; 