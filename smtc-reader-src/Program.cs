using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.Media.Control;

class Program
{
    static async Task Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        
        // Single-shot mode if --once argument is passed
        bool once = args.Length > 0 && args[0] == "--once";

        GlobalSystemMediaTransportControlsSessionManager manager;
        try
        {
            manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"error\":" + JsonSerializer.Serialize("Failed to initialize SMTC: " + ex.Message) + "}");
            return;
        }

        string lastOutput = "";

        while (true)
        {
            try
            {
                GlobalSystemMediaTransportControlsSession? activeSession = null;

                // Priority 1: Check all sessions for one that is currently Playing
                var sessions = manager.GetSessions();
                foreach (var s in sessions)
                {
                    try
                    {
                        var info = s.GetPlaybackInfo();
                        if (info != null && info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                        {
                            activeSession = s;
                            // Prioritize Spotify or browser if multiple playing
                            string app = (s.SourceAppUserModelId ?? "").ToLower();
                            if (app.Contains("spotify"))
                            {
                                break;
                            }
                        }
                    }
                    catch { }
                }

                // Priority 2: Fallback to OS current session
                if (activeSession == null)
                {
                    activeSession = manager.GetCurrentSession();
                }

                // Priority 3: Fallback to the first available session
                if (activeSession == null && sessions.Count > 0)
                {
                    activeSession = sessions[0];
                }

                if (activeSession != null)
                {
                    var media = await activeSession.TryGetMediaPropertiesAsync();
                    var timeline = activeSession.GetTimelineProperties();
                    var playback = activeSession.GetPlaybackInfo();

                    string title = media?.Title ?? "";
                    string artist = media?.Artist ?? "";
                    string album = media?.AlbumTitle ?? "";
                    string status = playback?.PlaybackStatus.ToString() ?? "Closed";
                    double posSec = timeline != null ? Math.Round(timeline.Position.TotalSeconds, 2) : 0;
                    double durSec = timeline != null ? Math.Round(timeline.EndTime.TotalSeconds, 2) : 0;
                    string appId = activeSession.SourceAppUserModelId ?? "";

                    var data = new
                    {
                        appId = appId,
                        title = title,
                        artist = artist,
                        album = album,
                        status = status,
                        positionSec = posSec,
                        durationSec = durSec
                    };

                    string json = JsonSerializer.Serialize(data);
                    if (json != lastOutput || once)
                    {
                        Console.WriteLine(json);
                        lastOutput = json;
                    }
                }
                else
                {
                    string json = "{\"status\":\"Closed\"}";
                    if (json != lastOutput || once)
                    {
                        Console.WriteLine(json);
                        lastOutput = json;
                    }
                }
            }
            catch (Exception ex)
            {
                // Silently ignore transient COM/WinRT access errors during track change
            }

            if (once) break;

            await Task.Delay(250);
        }
    }
}
