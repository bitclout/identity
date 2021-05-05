import {Component, OnInit} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {GlobalVarsService} from './global-vars.service';
import {IdentityService} from './identity.service';
import {AccessLevel, Network} from '../types/identity';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  title = 'identity';

  loading = true;

  constructor(
    private activatedRoute: ActivatedRoute,
    private globalVars: GlobalVarsService,
    private identityService: IdentityService,
  ) { }

  ngOnInit(): void {
    this.activatedRoute.queryParams.subscribe(params => {
      if (params.webview) {
        this.globalVars.webview = true;
      }

      // Store testnet for duration of this session
      if (params.testnet) {
        this.globalVars.network = Network.testnet;
      }

      if (params.accessLevelRequest) {
        this.globalVars.accessLevelRequest = parseInt(params.accessLevelRequest, 10);
      }
    });

    this.identityService.initialize().subscribe(res => {
      this.globalVars.hostname = res.hostname;
      if (this.globalVars.isFullAccessHostname()) {
        this.globalVars.accessLevelRequest = AccessLevel.Full;
      }

      // We must be a webview OR in an iframe OR opened with window.open
      if (!this.globalVars.webview && !this.globalVars.inTab && !this.globalVars.inFrame()) {
        window.location.href = `https://${this.globalVars.environment.nodeHostname}`;
        return;
      }

      this.loading = false;
    });
  }
}
