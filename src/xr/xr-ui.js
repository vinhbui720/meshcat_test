import * as dat_module from 'dat.gui';
const dat = dat_module.default || dat_module;

export class XRUI {
    constructor(viewer) {
        this.viewer = viewer;
        this.gui = new dat.GUI({ autoPlace: false });
        this.gui.domElement.id = 'meshcat-xr-gui';
        this.gui.domElement.style.position = 'absolute';
        this.gui.domElement.style.left = '10px';
        this.gui.domElement.style.top = '10px';
        this.gui.domElement.style.zIndex = '1000';
        document.body.appendChild(this.gui.domElement);

        this.settings = {
            enableStreaming: true,
            streamFrequency: 120,
            mockMode: true,
            showLandmarks: true,
            handSide: 'Right'
        };

        this.setupGUI();
    }

    setupGUI() {
        const folder = this.gui.addFolder('XR Hand Tracking');
        folder.add(this.settings, 'enableStreaming').name('Enable Streaming');
        folder.add(this.settings, 'streamFrequency', 1, 120, 1).name('Freq (Hz)');
        folder.add(this.settings, 'mockMode').name('Mock Mode');
        folder.add(this.settings, 'showLandmarks').name('Show Landmarks');
        folder.add(this.settings, 'handSide', ['Left', 'Right']).name('Hand');
        folder.open();
    }

    update() {
        // Handle any dynamic UI updates
    }
}
