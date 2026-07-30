from argparse import Namespace
from unittest import TestCase
from unittest.mock import patch

from wambridge.radio_cli import _play_tunein_safely
from wambridge.tunein import WamPreset


class RadioControlCliTests(TestCase):
    @patch("wambridge.radio_cli._wait_for_tunein_playback")
    @patch("wambridge.radio_cli.play_tunein_preset")
    @patch("wambridge.radio_cli.get_mute", return_value=False)
    @patch("wambridge.radio_cli.get_volume", return_value=37)
    @patch("wambridge.radio_cli.find_tunein_preset")
    @patch("wambridge.radio_cli.get_tunein_presets")
    @patch("wambridge.radio_cli.set_mute")
    @patch("wambridge.radio_cli.set_volume")
    def test_tunein_play_uses_volume_safety(
        self,
        volume_mock,
        mute_mock,
        presets_mock,
        find_mock,
        _get_volume_mock,
        _get_mute_mock,
        play_mock,
        wait_mock,
    ) -> None:
        preset = WamPreset(content_id="0", title="Paradise", kind="my")
        presets_mock.return_value = [preset]
        find_mock.return_value = preset
        args = Namespace(
            tunein_play="Paradise",
            volume=None,
            max_start_volume=10,
        )

        result = _play_tunein_safely(args, "10.0.0.118", 55001)

        self.assertEqual(result, 0)
        play_mock.assert_called_once_with(
            "10.0.0.118",
            preset,
            port=55001,
        )
        wait_mock.assert_called_once_with("10.0.0.118", port=55001)
        self.assertEqual(
            [call.args[1] for call in volume_mock.call_args_list],
            [0, 10],
        )
        self.assertEqual(
            [call.args[1] for call in mute_mock.call_args_list],
            [True, False],
        )

    @patch(
        "wambridge.radio_cli.play_tunein_preset",
        side_effect=RuntimeError("boom"),
    )
    @patch("wambridge.radio_cli.get_mute", return_value=True)
    @patch("wambridge.radio_cli.get_volume", return_value=7)
    @patch("wambridge.radio_cli.find_tunein_preset")
    @patch("wambridge.radio_cli.get_tunein_presets")
    @patch("wambridge.radio_cli.set_mute")
    @patch("wambridge.radio_cli.set_volume")
    def test_tunein_failure_restores_previous_state(
        self,
        volume_mock,
        mute_mock,
        presets_mock,
        find_mock,
        _get_volume_mock,
        _get_mute_mock,
        _play_mock,
    ) -> None:
        preset = WamPreset(content_id="0", title="Paradise", kind="my")
        presets_mock.return_value = [preset]
        find_mock.return_value = preset
        args = Namespace(
            tunein_play="0",
            volume=None,
            max_start_volume=10,
        )

        with self.assertRaisesRegex(RuntimeError, "boom"):
            _play_tunein_safely(args, "10.0.0.118", 55001)

        self.assertEqual(
            [call.args[1] for call in volume_mock.call_args_list],
            [0, 7],
        )
        self.assertEqual(
            [call.args[1] for call in mute_mock.call_args_list],
            [True, True],
        )
