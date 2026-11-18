<?php
/**
 * Plugin Name: Goldcrest Land & Forestry Market Map
 * Plugin URI:  https://goldcrestlfg.com/land-forestry-market-map/
 * Description: Interactive Leaflet UK market map with Google Sheets "Map (public)" CSV sync, Property CPT mapping, Elementor widget, WP REST enquiry dispatch, and Mailchimp Buyer Inquiry integration.
 * Version:     1.0.0
 * Requires at least: 6.2
 * Requires PHP: 8.0
 * Author:      Goldcrest Land & Forestry Group
 * Text Domain: goldcrest-market-map
 */

defined( 'ABSPATH' ) || exit;

final class Goldcrest_Market_Map_Plugin {

    const VERSION       = '1.0.0';
    const OPTION_KEY    = 'gc_market_map_settings';
    const CACHE_KEY     = 'gc_market_map_points_cache';
    const CRON_HOOK     = 'gc_market_map_cron_sync';
    const REST_NS       = 'goldcrest-map/v1';

    private static ?self $instance = null;
    private bool $assets_enqueued  = false;

    public static function instance(): self {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        register_activation_hook( __FILE__, array( __CLASS__, 'activate' ) );
        register_deactivation_hook( __FILE__, array( __CLASS__, 'deactivate' ) );

        add_action( 'init', array( $this, 'register_shortcode' ) );
        add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ) );
        add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
        add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
        add_action( 'admin_init', array( $this, 'register_settings' ) );
        add_action( 'admin_post_gc_map_sync_now', array( $this, 'handle_manual_sync' ) );
        add_action( self::CRON_HOOK, array( $this, 'sync_from_sources' ) );
        add_action( 'elementor/widgets/register', array( $this, 'register_elementor_widget' ) );
    }

    public static function default_settings(): array {
        return array(
            'os_api_key'            => '',
            'os_style'              => 'Light_3857',
            'os_max_native_zoom'    => 16,
            'esri_api_key'          => '',
            'other_max_zoom'        => 12,
            'sheets_csv_url'        => '',
            'sync_schedule'         => 'daily',
            'cpt_sync_enabled'      => 1,
            'recipient_email'       => 'office@goldcrestlfg.com',
            'mailchimp_api_key'     => '',
            'mailchimp_audience_id' => '',
            'mailchimp_tag'         => 'Buyer Inquiry',
        );
    }

    public static function get_settings(): array {
        $saved = get_option( self::OPTION_KEY, array() );
        return wp_parse_args( is_array( $saved ) ? $saved : array(), self::default_settings() );
    }

    public static function activate(): void {
        if ( false === get_option( self::OPTION_KEY ) ) {
            add_option( self::OPTION_KEY, self::default_settings() );
        }
        if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
            $settings = self::get_settings();
            wp_schedule_event( time() + 300, $settings['sync_schedule'], self::CRON_HOOK );
        }
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook( self::CRON_HOOK );
    }

    /**
     * Register assets without loading them globally so WP Go Maps Pro on other pages is never affected.
     */
    public function register_assets(): void {
        $base_url = plugin_dir_url( __FILE__ );

        wp_register_style(
            'gc-leaflet',
            'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
            array(),
            '1.9.4'
        );

        wp_register_style(
            'gc-market-map-fonts',
            'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Montserrat:wght@400;500;600;700&display=swap',
            array(),
            null
        );

        wp_register_style(
            'gc-market-map',
            $base_url . 'css/market-map.css',
            array( 'gc-leaflet', 'gc-market-map-fonts' ),
            self::VERSION
        );

        wp_register_script(
            'gc-leaflet',
            'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
            array(),
            '1.9.4',
            true
        );

        wp_register_script(
            'gc-uk-basemap',
            $base_url . 'data/uk-basemap.js',
            array(),
            self::VERSION,
            true
        );

        wp_register_script(
            'gc-market-points',
            $base_url . 'data/points.js',
            array(),
            self::VERSION,
            true
        );

        wp_register_script(
            'gc-market-map',
            $base_url . 'js/market-map.js',
            array( 'gc-leaflet', 'gc-uk-basemap', 'gc-market-points' ),
            self::VERSION,
            true
        );
    }

    /**
     * Enqueue map styles and scripts strictly when [goldcrest_market_map] or the Elementor widget renders.
     */
    public function enqueue_map_assets(): void {
        if ( $this->assets_enqueued ) {
            return;
        }
        $this->assets_enqueued = true;

        wp_enqueue_style( 'gc-market-map' );
        wp_enqueue_script( 'gc-market-map' );

        $settings = self::get_settings();
        $config   = array(
            'osApiKey'        => (string) $settings['os_api_key'],
            'osStyle'         => (string) $settings['os_style'],
            'osMaxNativeZoom' => (int) $settings['os_max_native_zoom'],
            'esriApiKey'      => (string) $settings['esri_api_key'],
            'otherMaxZoom'    => (int) $settings['other_max_zoom'],
            'enquiryEndpoint' => esc_url_raw( rest_url( self::REST_NS . '/enquiry' ) ),
            'restNonce'       => wp_create_nonce( 'wp_rest' ),
            'recipientEmail'  => sanitize_email( $settings['recipient_email'] ),
            'mailchimpTag'    => sanitize_text_field( $settings['mailchimp_tag'] ),
            'demoMode'        => false,
        );

        wp_localize_script( 'gc-market-map', 'GC_MAP_CONFIG', $config );

        $cached_points = get_option( self::CACHE_KEY, array() );
        if ( ! empty( $cached_points ) && is_array( $cached_points ) ) {
            wp_add_inline_script(
                'gc-market-points',
                'window.GC_PTS = ' . wp_json_encode( array_values( $cached_points ) ) . ';',
                'after'
            );
        }
    }

    public function register_shortcode(): void {
        add_shortcode( 'goldcrest_market_map', array( $this, 'render_shortcode' ) );
    }

    public function render_shortcode( array $atts = array() ): string {
        $atts = shortcode_atts(
            array(
                'show_header' => 'false',
                'height'      => '74vh',
            ),
            $atts,
            'goldcrest_market_map'
        );

        $this->enqueue_map_assets();

        $show_header = filter_var( $atts['show_header'], FILTER_VALIDATE_BOOLEAN );
        $logo_url    = esc_url( plugin_dir_url( __FILE__ ) . 'assets/goldcrest-logo-white.png' );
        $last_sync   = get_option( 'gc_market_map_last_sync', gmdate( 'd/m/Y' ) );

        ob_start();
        ?>
        <div id="gc-land-forestry-map" class="gc-land-forestry-map">
            <?php if ( $show_header ) : ?>
            <div class="band wrap">
                <div class="inner">
                    <img src="<?php echo $logo_url; ?>" alt="Goldcrest Land &amp; Forestry Group">
                    <div class="titles">
                        <p class="eyebrow">Goldcrest Land &amp; Forestry Group</p>
                        <h1>Land &amp; Forestry Market Map</h1>
                        <p class="strap">Forests, farms and estates for sale across the UK. <strong>Our own listings and the wider market, in one place.</strong> Interested in one? We can appraise it independently and act for you as buyer.</p>
                    </div>
                </div>
            </div>
            <?php endif; ?>

            <div class="bar wrap">
                <div class="inner">
                    <div class="f">
                        <span class="f-label">Show</span>
                        <div class="seg" role="group" aria-label="Show listings">
                            <button type="button" data-show="all" aria-pressed="true">All</button>
                            <button type="button" data-show="Goldcrest" aria-pressed="false">Goldcrest</button>
                            <button type="button" data-show="Other" aria-pressed="false">Wider market</button>
                        </div>
                    </div>
                    <div class="f"><label for="fCountry">Country</label><select id="fCountry"></select></div>
                    <div class="f"><label for="fRegion">Region</label><select id="fRegion"></select></div>
                    <div class="f"><label for="fType">Category</label><select id="fType"></select></div>
                    <div class="f"><label for="fSize">Size</label><select id="fSize"></select></div>
                    <div class="f"><label for="fPrice">Price</label><select id="fPrice"></select></div>
                    <button class="reset" type="button" id="reset">Clear filters</button>
                    <div class="count" id="count"></div>
                </div>
            </div>

            <div class="wrap">
                <div class="stage" id="stage">
                    <div class="mapbox" id="mapbox">
                        <div id="map" role="application" aria-label="Map of the UK with a pin for each opportunity"></div>
                        <div class="ctrl">
                            <div class="seg basemap" role="group" aria-label="Map style">
                                <button type="button" data-base="map" aria-pressed="true">Map</button>
                                <button type="button" data-base="sat" aria-pressed="false">Satellite</button>
                            </div>
                            <div class="zoom">
                                <button type="button" id="zin" aria-label="Zoom in">+</button>
                                <button type="button" id="zout" aria-label="Zoom out">-</button>
                            </div>
                        </div>
                        <div class="toast" id="toast" hidden>Wider-market pins are approximate, so they are hidden at this zoom. Zoom out to see them.</div>
                        <div class="legend">
                            <span class="t">Key</span>
                            <span class="lg"><span class="sw g"></span>Goldcrest listing</span>
                            <span class="lg"><span class="sw o"></span>On the market elsewhere</span>
                            <span class="note">Wider-market pins show approximate locations (within c. 1 km).</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="foot wrap">
                <div class="inner">
                    <p><b>About the map.</b> Navy pins are properties currently marketed by other agents. Goldcrest is not the selling agent for these, but we can appraise any of them independently and act for you as buyer. Details are summarised from published particulars, change quickly and should be confirmed before acting. Updated weekly; last synced <?php echo esc_html( $last_sync ); ?>.</p>
                </div>
            </div>

            <div id="card" class="card" hidden></div>
            <div id="scrim" class="scrim" hidden></div>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    /**
     * Register Elementor Widget wrapper if Elementor is active.
     */
    public function register_elementor_widget( $widgets_manager ): void {
        if ( ! class_exists( '\Elementor\Widget_Base' ) ) {
            return;
        }
        $widgets_manager->register( new class extends \Elementor\Widget_Base {
            public function get_name(): string {
                return 'goldcrest_market_map';
            }
            public function get_title(): string {
                return 'Goldcrest Market Map';
            }
            public function get_icon(): string {
                return 'eicon-google-maps';
            }
            public function get_categories(): array {
                return array( 'general' );
            }
            protected function render(): void {
                echo do_shortcode( '[goldcrest_market_map]' );
            }
        } );
    }

    /**
     * Register REST endpoint: POST /wp-json/goldcrest-map/v1/enquiry
     */
    public function register_rest_routes(): void {
        register_rest_route(
            self::REST_NS,
            '/enquiry',
            array(
                'methods'             => \WP_REST_Server::CREATABLE,
                'callback'            => array( $this, 'handle_enquiry' ),
                'permission_callback' => array( $this, 'verify_rest_nonce' ),
            )
        );
    }

    public function verify_rest_nonce( \WP_REST_Request $request ): bool {
        $nonce = $request->get_header( 'X-WP-Nonce' );
        return is_string( $nonce ) && (bool) wp_verify_nonce( $nonce, 'wp_rest' );
    }

    public function handle_enquiry( \WP_REST_Request $request ): \WP_REST_Response {
        $params = $request->get_json_params();
        if ( ! is_array( $params ) ) {
            return new \WP_REST_Response( array( 'error' => 'Invalid JSON payload' ), 400 );
        }

        // Honeypot check: silently accept bots without sending emails or syncing CRM
        if ( ! empty( $params['website'] ) ) {
            return new \WP_REST_Response( array( 'ok' => true, 'status' => 'accepted' ), 200 );
        }

        if ( empty( $params['gdprConsent'] ) ) {
            return new \WP_REST_Response( array( 'error' => 'GDPR consent is required' ), 422 );
        }

        $ref      = sanitize_text_field( (string) ( $params['ref'] ?? '' ) );
        $name     = sanitize_text_field( (string) ( $params['name'] ?? '' ) );
        $phone    = sanitize_text_field( (string) ( $params['phone'] ?? '' ) );
        $email    = sanitize_email( (string) ( $params['email'] ?? '' ) );
        $message  = sanitize_textarea_field( (string) ( $params['message'] ?? '' ) );
        $property = sanitize_text_field( (string) ( $params['property'] ?? '' ) );
        $act_for  = ! empty( $params['actForMe'] );

        if ( '' === $name || ! is_email( $email ) ) {
            return new \WP_REST_Response( array( 'error' => 'Valid name and email are required' ), 422 );
        }

        $settings  = self::get_settings();
        $recipient = sanitize_email( $settings['recipient_email'] ) ?: 'office@goldcrestlfg.com';
        $subject   = sprintf( '[Goldcrest Market Map] Buyer Enquiry: %s', $ref ?: 'Market Opportunity' );

        $body = implode(
            "\n",
            array(
                'New Market Map Property Enquiry',
                '--------------------------------',
                'Reference:      ' . $ref,
                'Property:       ' . $property,
                'Name:           ' . $name,
                'Email:          ' . $email,
                'Phone:          ' . $phone,
                'Act as Buyer:   ' . ( $act_for ? 'Yes (Independent appraisal requested)' : 'No' ),
                'GDPR Consent:   Confirmed at ' . gmdate( 'c' ),
                '',
                'Message:',
                $message ?: '(No additional message provided)',
            )
        );

        $headers = array(
            'Content-Type: text/plain; charset=UTF-8',
            'Reply-To: ' . $name . ' <' . $email . '>',
        );

        $mail_sent = wp_mail( $recipient, $subject, $body, $headers );

        $mc_result = $this->sync_mailchimp_lead(
            $settings,
            $email,
            $name,
            $phone
        );

        return new \WP_REST_Response(
            array(
                'ok'        => true,
                'mailSent'  => (bool) $mail_sent,
                'mailchimp' => $mc_result,
                'ref'       => $ref,
            ),
            200
        );
    }

    /**
     * Upsert lead into Mailchimp Audience v3 and apply the "Buyer Inquiry" tag.
     */
    private function sync_mailchimp_lead( array $settings, string $email, string $name, string $phone ): array {
        $api_key     = trim( (string) $settings['mailchimp_api_key'] );
        $audience_id = trim( (string) $settings['mailchimp_audience_id'] );
        $tag         = trim( (string) $settings['mailchimp_tag'] ) ?: 'Buyer Inquiry';

        if ( '' === $api_key || '' === $audience_id || false === strpos( $api_key, '-' ) ) {
            return array( 'synced' => false, 'reason' => 'Mailchimp credentials not configured' );
        }

        list( , $dc ) = explode( '-', $api_key, 2 );
        $parts       = preg_split( '/\s+/', trim( $name ), 2 );
        $fname       = $parts[0] ?? '';
        $lname       = $parts[1] ?? '';
        $hash        = md5( strtolower( trim( $email ) ) );
        $auth        = 'Basic ' . base64_encode( 'anystring:' . $api_key );

        $member_url = sprintf(
            'https://%s.api.mailchimp.com/3.0/lists/%s/members/%s',
            rawurlencode( $dc ),
            rawurlencode( $audience_id ),
            $hash
        );

        $upsert = wp_remote_request(
            $member_url,
            array(
                'method'  => 'PUT',
                'timeout' => 10,
                'headers' => array(
                    'Authorization' => $auth,
                    'Content-Type'  => 'application/json',
                ),
                'body'    => wp_json_encode(
                    array(
                        'email_address' => $email,
                        'status_if_new' => 'subscribed',
                        'merge_fields'  => array(
                            'EMAIL' => $email,
                            'FNAME' => $fname,
                            'LNAME' => $lname,
                            'PHONE' => $phone,
                        ),
                    )
                ),
            )
        );

        if ( is_wp_error( $upsert ) ) {
            return array( 'synced' => false, 'error' => $upsert->get_error_message() );
        }

        wp_remote_post(
            $member_url . '/tags',
            array(
                'timeout' => 10,
                'headers' => array(
                    'Authorization' => $auth,
                    'Content-Type'  => 'application/json',
                ),
                'body'    => wp_json_encode(
                    array(
                        'tags' => array(
                            array(
                                'name'   => $tag,
                                'status' => 'active',
                            ),
                        ),
                    )
                ),
            )
        );

        return array(
            'synced' => true,
            'tag'    => $tag,
            'fields' => array( 'EMAIL', 'FNAME', 'LNAME', 'PHONE' ),
        );
    }

    /**
     * WP-Cron & manual sync: parses Google Sheets "Map (public)" CSV and optional Property CPT posts.
     */
    public function sync_from_sources(): array {
        $settings = self::get_settings();
        $points   = array();

        if ( ! empty( $settings['sheets_csv_url'] ) ) {
            $resp = wp_remote_get( esc_url_raw( $settings['sheets_csv_url'] ), array( 'timeout' => 15 ) );
            if ( ! is_wp_error( $resp ) && 200 === wp_remote_retrieve_response_code( $resp ) ) {
                $points = $this->parse_public_sheet_csv( wp_remote_retrieve_body( $resp ) );
            }
        }

        if ( ! empty( $settings['cpt_sync_enabled'] ) ) {
            $cpt_points = $this->load_property_cpt_pins();
            if ( ! empty( $cpt_points ) ) {
                $points = array_values(
                    array_filter(
                        $points,
                        static fn( array $p ): bool => ( $p['pin'] ?? '' ) !== 'Goldcrest'
                    )
                );
                $points = array_merge( $cpt_points, $points );
            }
        }

        if ( ! empty( $points ) ) {
            update_option( self::CACHE_KEY, $points, false );
            update_option( 'gc_market_map_last_sync', gmdate( 'd/m/Y H:i' ) . ' UTC', false );
        }

        return $points;
    }

    private function parse_public_sheet_csv( string $csv_body ): array {
        $lines = preg_split( "/\r\n|\n|\r/", trim( $csv_body ) );
        if ( count( $lines ) < 2 ) {
            return array();
        }

        $header = str_getcsv( array_shift( $lines ) );
        $idx    = array_flip( array_map( 'trim', $header ) );
        $out    = array();

        foreach ( $lines as $line ) {
            if ( '' === trim( $line ) ) {
                continue;
            }
            $row    = str_getcsv( $line );
            $status = trim( (string) ( $row[ $idx['Status'] ?? -1 ] ?? '' ) );
            if ( 0 !== strcasecmp( $status, 'For sale' ) ) {
                continue;
            }

            $pin   = trim( (string) ( $row[ $idx['Pin'] ?? -1 ] ?? 'Other' ) );
            $is_gc = ( 'Goldcrest' === $pin );
            $lat   = (float) ( $row[ $idx['Latitude'] ?? -1 ] ?? 0 );
            $lon   = (float) ( $row[ $idx['Longitude'] ?? -1 ] ?? 0 );

            if ( ! $lat || ! $lon ) {
                continue;
            }

            $out[] = array(
                'ref'     => sanitize_text_field( (string) ( $row[ $idx['Ref'] ?? -1 ] ?? '' ) ),
                'pin'     => $is_gc ? 'Goldcrest' : 'Other',
                'name'    => $is_gc ? sanitize_text_field( (string) ( $row[ $idx['Name'] ?? -1 ] ?? '' ) ) : '',
                'status'  => 'For sale',
                'type'    => sanitize_text_field( (string) ( $row[ $idx['Categories'] ?? -1 ] ?? '' ) ),
                'country' => sanitize_text_field( (string) ( $row[ $idx['Country'] ?? -1 ] ?? '' ) ),
                'region'  => sanitize_text_field( (string) ( $row[ $idx['Region'] ?? -1 ] ?? '' ) ),
                'ha'      => round( (float) ( $row[ $idx['Area (ha)'] ?? -1 ] ?? 0 ), 2 ),
                'ac'      => round( (float) ( $row[ $idx['Area (acres)'] ?? -1 ] ?? 0 ), 2 ),
                'guide'   => sanitize_text_field( (string) ( $row[ $idx['Guide price'] ?? -1 ] ?? '' ) ),
                'link'    => $is_gc ? esc_url_raw( (string) ( $row[ $idx['Link'] ?? -1 ] ?? '' ) ) : '',
                'price'   => (int) preg_replace( '/[^0-9]/', '', (string) ( $row[ $idx['Price (£)'] ?? -1 ] ?? '0' ) ),
                'lat'     => $is_gc ? $lat : round( $lat, 2 ),
                'lon'     => $is_gc ? $lon : round( $lon, 2 ),
            );
        }

        return $out;
    }

    private function load_property_cpt_pins(): array {
        if ( ! post_type_exists( 'property' ) ) {
            return array();
        }

        $query = new \WP_Query(
            array(
                'post_type'      => 'property',
                'post_status'    => 'publish',
                'posts_per_page' => 200,
                'meta_query'     => array(
                    array(
                        'key'     => 'gc_property_status',
                        'value'   => 'For sale',
                        'compare' => '=',
                    ),
                ),
            )
        );

        $pins = array();
        foreach ( $query->posts as $post ) {
            $lat = (float) get_post_meta( $post->ID, 'gc_lat', true );
            $lon = (float) get_post_meta( $post->ID, 'gc_lon', true );
            if ( ! $lat || ! $lon ) {
                continue;
            }
            $ha = (float) get_post_meta( $post->ID, 'gc_area_ha', true );
            $ac = (float) get_post_meta( $post->ID, 'gc_area_acres', true );

            $pins[] = array(
                'ref'     => '',
                'pin'     => 'Goldcrest',
                'name'    => get_the_title( $post ),
                'status'  => 'For sale',
                'type'    => (string) get_post_meta( $post->ID, 'gc_categories', true ),
                'country' => (string) get_post_meta( $post->ID, 'gc_country', true ),
                'region'  => (string) get_post_meta( $post->ID, 'gc_region', true ),
                'ha'      => round( $ha, 2 ),
                'ac'      => round( $ac ?: $ha * 2.47105, 2 ),
                'guide'   => (string) get_post_meta( $post->ID, 'gc_guide_price', true ),
                'link'    => get_permalink( $post ),
                'price'   => (int) get_post_meta( $post->ID, 'gc_price_numeric', true ),
                'lat'     => $lat,
                'lon'     => $lon,
            );
        }

        return $pins;
    }

    public function register_admin_menu(): void {
        add_options_page(
            'Goldcrest Market Map',
            'Goldcrest Market Map',
            'manage_options',
            'goldcrest-market-map',
            array( $this, 'render_admin_page' )
        );
    }

    public function register_settings(): void {
        register_setting( self::OPTION_KEY, self::OPTION_KEY, array( $this, 'sanitize_settings' ) );
    }

    public function sanitize_settings( array $input ): array {
        $defaults = self::default_settings();
        $clean    = array(
            'os_api_key'            => sanitize_text_field( $input['os_api_key'] ?? '' ),
            'os_style'              => in_array( $input['os_style'] ?? '', array( 'Light_3857', 'Road_3857', 'Outdoor_3857' ), true ) ? $input['os_style'] : 'Light_3857',
            'os_max_native_zoom'    => max( 12, min( 20, (int) ( $input['os_max_native_zoom'] ?? 16 ) ) ),
            'esri_api_key'          => sanitize_text_field( $input['esri_api_key'] ?? '' ),
            'other_max_zoom'        => max( 8, min( 16, (int) ( $input['other_max_zoom'] ?? 12 ) ) ),
            'sheets_csv_url'        => esc_url_raw( $input['sheets_csv_url'] ?? '' ),
            'sync_schedule'         => in_array( $input['sync_schedule'] ?? '', array( 'hourly', 'twicedaily', 'daily', 'weekly' ), true ) ? $input['sync_schedule'] : 'daily',
            'cpt_sync_enabled'      => empty( $input['cpt_sync_enabled'] ) ? 0 : 1,
            'recipient_email'       => sanitize_email( $input['recipient_email'] ?? $defaults['recipient_email'] ),
            'mailchimp_api_key'     => sanitize_text_field( $input['mailchimp_api_key'] ?? '' ),
            'mailchimp_audience_id' => sanitize_text_field( $input['mailchimp_audience_id'] ?? '' ),
            'mailchimp_tag'         => sanitize_text_field( $input['mailchimp_tag'] ?? 'Buyer Inquiry' ),
        );

        wp_clear_scheduled_hook( self::CRON_HOOK );
        wp_schedule_event( time() + 300, $clean['sync_schedule'], self::CRON_HOOK );

        return $clean;
    }

    public function handle_manual_sync(): void {
        if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'gc_map_sync_now' ) ) {
            wp_die( 'Unauthorized' );
        }
        $this->sync_from_sources();
        wp_safe_redirect( admin_url( 'options-general.php?page=goldcrest-market-map&synced=1' ) );
        exit;
    }

    public function render_admin_page(): void {
        $s = self::get_settings();
        ?>
        <div class="wrap">
            <h1>Goldcrest Land &amp; Forestry Market Map</h1>
            <p>Embed on any page or Elementor layout using <code>[goldcrest_market_map]</code>. Assets load conditionally only on pages containing the map.</p>
            <form method="post" action="options.php">
                <?php settings_fields( self::OPTION_KEY ); ?>
                <table class="form-table" role="presentation">
                    <tr><th scope="row">OS Maps API Key</th><td><input type="text" class="regular-text" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[os_api_key]" value="<?php echo esc_attr( $s['os_api_key'] ); ?>"></td></tr>
                    <tr><th scope="row">OS Style</th><td><input type="text" class="regular-text" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[os_style]" value="<?php echo esc_attr( $s['os_style'] ); ?>"></td></tr>
                    <tr><th scope="row">OS Max Native Zoom</th><td><input type="number" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[os_max_native_zoom]" value="<?php echo esc_attr( (string) $s['os_max_native_zoom'] ); ?>"></td></tr>
                    <tr><th scope="row">Esri ArcGIS API Key</th><td><input type="text" class="regular-text" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[esri_api_key]" value="<?php echo esc_attr( $s['esri_api_key'] ); ?>"></td></tr>
                    <tr><th scope="row">Wider-Market Max Zoom</th><td><input type="number" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[other_max_zoom]" value="<?php echo esc_attr( (string) $s['other_max_zoom'] ); ?>"></td></tr>
                    <tr><th scope="row">Google Sheet CSV URL ("Map (public)")</th><td><input type="url" class="large-text" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[sheets_csv_url]" value="<?php echo esc_attr( $s['sheets_csv_url'] ); ?>"></td></tr>
                    <tr><th scope="row">Mailchimp Audience ID</th><td><input type="text" class="regular-text" name="<?php echo esc_attr( self::OPTION_KEY ); ?>[mailchimp_audience_id]" value="<?php echo esc_attr( $s['mailchimp_audience_id'] ); ?>"></td></tr>
                </table>
                <?php submit_button( 'Save Settings' ); ?>
            </form>
            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
                <?php wp_nonce_field( 'gc_map_sync_now' ); ?>
                <input type="hidden" name="action" value="gc_map_sync_now">
                <?php submit_button( 'Run Sheet & CPT Sync Now', 'secondary' ); ?>
            </form>
        </div>
        <?php
    }
}

Goldcrest_Market_Map_Plugin::instance();
