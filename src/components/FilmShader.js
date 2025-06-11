/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Film grain & scanlines shader
 *
 * - ported from HLSL to WebGL / GLSL
 * http://www.truevision3d.com/forums/showcase/staticnoise_colorstaticnoise_and_filmgrain_shaders-t18698.0.html
 *
 * Screen Space Static Postprocessor
 *
 * Produces an analogue noise overlay image pattern.
 *
 * Ported to vvvv framework
 * by vux from this http://www.geeks3d.com/20090904/shader-library-2d-post-processing-effects-glsl/
 */

const FilmShader = {

	uniforms: {

		'tDiffuse': { value: null },
		'time': { value: 0.0 },
		'nIntensity': { value: 0.5 },
		'sIntensity': { value: 0.05 },
		'sCount': { value: 4096 },
		'grayscale': { value: 1 }

	},

	vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

	fragmentShader: /* glsl */`

		// control parameter
		uniform float time;

		uniform bool grayscale;

		// noise effect
		uniform float nIntensity;

		// scanlines
		uniform float sIntensity;
		uniform float sCount;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		// A simple pseudo-random function but good enough for this effect.
		float rand(vec2 co){
			return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
		}

		void main() {

			// sample the source
			vec4 cTextureScreen = texture2D( tDiffuse, vUv );

			// make some noise
			float dx = rand( vUv + time );

			// add noise
			vec3 cResult = cTextureScreen.rgb + cTextureScreen.rgb * clamp( 0.1 + dx, 0.0, 1.0 );

			// get us a sine and cosine
			vec2 sc = vec2( sin( vUv.y * sCount ), cos( vUv.y * sCount ) );

			// add scanlines
			cResult += cTextureScreen.rgb * vec3( sc.x, sc.y, sc.x ) * sIntensity;

			// interpolate between source and result by intensity
			cResult = cTextureScreen.rgb + clamp( nIntensity, 0.0,1.0 ) * ( cResult - cTextureScreen.rgb );

			// convert to grayscale if desired
			if( grayscale ) {

				cResult = vec3( cResult.r * 0.3 + cResult.g * 0.59 + cResult.b * 0.11 );

			}

			gl_FragColor =  vec4( cResult, cTextureScreen.a );

		}`

};

export { FilmShader }; 